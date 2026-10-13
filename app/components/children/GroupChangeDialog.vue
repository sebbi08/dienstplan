<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { REVIEW_SECTIONS } from '#shared/types/api'
import type { ChildRecordDto, GroupChangeInput, ReviewSection } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Plans a group change of a child (new group, day, and per section whether it is kept) or, with `child.pendingGroupChange`
 * set, changes that planned one. Stays open when saving fails; closes once the record is reloaded.
 */
/** `reload` re-reads the record; the busy flag stays on until it is done. */
const props = defineProps<{ child: ChildRecordDto; groups: { id: number; name: string }[]; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())

const allKept = (): Record<ReviewSection, boolean> => Object.fromEntries(REVIEW_SECTIONS.map(section => [section, true])) as Record<ReviewSection, boolean>
const form = reactive({ groupId: 0, date: todayIso(), keep: allKept() })
const pending = computed(() => props.child.pendingGroupChange)

// Every time the dialog opens it starts from the planned change (edit) or from scratch (new).
watch(open, (value) => {
  if (!value) return
  const change = pending.value
  Object.assign(form, change
    ? { groupId: change.groupId, date: change.date, keep: { ...change.keep } }
    : { groupId: 0, date: todayIso(), keep: allKept() })
})

// The new group must differ from the current one (the server answers `same_group` otherwise); the target of the planned
// change stays selectable so that the pre-filled value has an item.
const groupItems = computed(() => props.groups
  .filter(group => group.id !== props.child.master.groupId || group.id === pending.value?.groupId)
  .map(group => ({ label: group.name, value: group.id })))
const valid = computed(() => form.groupId > 0 && form.date !== '')

async function save() {
  if (!valid.value) return
  const body: GroupChangeInput = { groupId: form.groupId, date: form.date, keep: { ...form.keep } }
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
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ de.groupChange.keepTitle }}</legend>
          <p class="text-xs text-gray-500">{{ de.groupChange.keepHint }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <UCheckbox v-for="section in REVIEW_SECTIONS" :key="section" v-model="form.keep[section]" :label="de.groupChange.sections[section]" />
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
