<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { KEEP_SECTIONS } from '#shared/types/api'
import type { ChildRecordDto, GroupChangeInput, KeepSection } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Plans a group change of a child (new group, day, and per section whether it is kept) or, with `child.pendingGroupChange`
 * set, changes that planned one. Stays open when saving fails; closes once the record is reloaded.
 */
/** `reload` re-reads the record; the busy flag stays on until it is done. */
const props = defineProps<{ child: ChildRecordDto; groups: { id: number; name: string; forSchoolChildren: boolean }[]; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())

const allKept = (): Record<KeepSection, boolean> => Object.fromEntries(KEEP_SECTIONS.map(section => [section, true])) as Record<KeepSection, boolean>
const form = reactive({ groupId: 0, date: todayIso(), keep: allKept(), newContract: false })
const pending = computed(() => props.child.pendingGroupChange)

// Every time the dialog opens it starts from the planned change (edit) or from scratch (new).
watch(open, (value) => {
  if (!value) return
  const change = pending.value
  Object.assign(form, change
    ? { groupId: change.groupId, date: change.date, keep: { ...change.keep }, newContract: change.newContract }
    : { groupId: 0, date: todayIso(), keep: allKept(), newContract: false })
})

// The new group must differ from the current one (the server answers `same_group` otherwise); the target of the planned
// change stays selectable so that the pre-filled value has an item.
const groupItems = computed(() => props.groups
  .filter(group => group.id !== props.child.master.groupId || group.id === pending.value?.groupId)
  .map(group => ({ label: group.name, value: group.id })))
// A change into a group for school children starts a further care contract; the server refuses it without the confirmation.
const forSchoolChildren = computed(() => props.groups.find(group => group.id === form.groupId)?.forSchoolChildren === true)
const valid = computed(() => form.groupId > 0 && form.date !== '' && (!forSchoolChildren.value || form.newContract))

async function save() {
  if (!valid.value) return
  const body: GroupChangeInput = { groupId: form.groupId, date: form.date, keep: { ...form.keep }, newContract: forSchoolChildren.value && form.newContract }
  const change = pending.value
  const request = change
    ? () => $fetch<unknown>(`/api/child-group-changes/${change.id}`, { method: 'PUT', body })
    : () => $fetch<unknown>(`/api/children/${props.child.id}/group-change`, { method: 'POST', body })
  if (await run(request, de.common.saved)) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="pending ? de.groupChange.editTitle : de.groupChange.plan">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="de.groupChange.group" required>
            <USelect v-model="form.groupId" :items="groupItems" :placeholder="de.groupChange.choose" class="w-full" />
          </UFormField>
          <UFormField :label="de.groupChange.date" required><UInput v-model="form.date" type="date" class="w-full" required /></UFormField>
        </div>
        <UCheckbox v-if="forSchoolChildren" v-model="form.newContract" :label="de.schoolChildren.newContract" />
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ de.groupChange.keepTitle }}</legend>
          <p class="text-xs text-gray-500">{{ de.groupChange.keepHint }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <UCheckbox v-for="section in KEEP_SECTIONS" :key="section" v-model="form.keep[section]" :label="de.groupChange.sections[section]" />
          </div>
        </fieldset>
        <div class="flex gap-2">
          <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !valid" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
