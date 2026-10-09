<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildMasterInput, ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { orNull } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * Master data (Stammdaten): the section of the record, or, without `child`, the form that creates a new child.
 * Only managers can choose a group (a Mitarbeiter may not read the group list); the group is kept as it is otherwise.
 */
const props = defineProps<{ child?: ChildRecordDto; lookups: ReturnType<typeof useChildLookups> }>()
const emit = defineEmits<{ saved: [] }>()
const run = useAction(async () => emit('saved'))
const { groups, careTypes, canPickGroup, groupName, careTypeName } = props.lookups

const creating = !props.child
const editing = ref(creating)
const today = todayIso()

const empty = { lastName: '', firstName: '', birthDate: '', address: '', groupId: 0, careTypeId: 0, entryDate: '', plannedEntryDate: '', infoMeetingDate: '', schoolStartDate: '', primarySchool: '', note: '' }
const form = reactive({ ...empty })
function reset() {
  const master = props.child?.master
  Object.assign(form, master
    ? {
        ...master, groupId: master.groupId ?? 0, careTypeId: master.careTypeId ?? 0,
        entryDate: master.entryDate ?? '', plannedEntryDate: master.plannedEntryDate ?? '',
        infoMeetingDate: master.infoMeetingDate ?? '', schoolStartDate: master.schoolStartDate ?? '',
      }
    : empty)
}
reset()
watch(() => props.child?.master, reset)

const showGroup = computed(() => (canPickGroup.value && groups.value.length > 0) || (!creating && props.child!.master.groupId !== null))
const groupItems = computed(() => [{ label: de.children.noGroup, value: 0 }, ...groups.value.map(group => ({ label: group.name, value: group.id }))])
const careTypeItems = computed(() => [{ label: de.children.noSelection, value: 0 }, ...careTypes.value.map(type => ({ label: type.name, value: type.id }))])

function payload(): ChildMasterInput {
  return {
    lastName: form.lastName, firstName: form.firstName, birthDate: form.birthDate, address: form.address,
    // Without the right to read the groups the form keeps what is stored (null for a new child).
    groupId: canPickGroup.value ? form.groupId || null : props.child?.master.groupId ?? null,
    careTypeId: form.careTypeId || null,
    entryDate: orNull(form.entryDate), plannedEntryDate: orNull(form.plannedEntryDate),
    infoMeetingDate: orNull(form.infoMeetingDate), schoolStartDate: orNull(form.schoolStartDate),
    primarySchool: form.primarySchool, note: form.note,
  }
}

async function save() {
  if (creating) {
    try {
      const { id } = await $fetch<{ id: number }>('/api/children', { method: 'POST', body: payload() })
      await navigateTo(`/children/${id}`)
    }
    catch (error) {
      useToast().add({ title: errorMessage(error), color: 'error' })
    }
    return
  }
  const ok = await run(() => $fetch<unknown>(`/api/children/${props.child!.id}/master`, { method: 'PUT', body: payload() }), de.common.saved)
  if (ok) editing.value = false
}

function cancel() {
  if (creating) {
    navigateTo('/children')
    return
  }
  reset()
  editing.value = false
}

const f = de.children.fields
const rows = computed(() => {
  const master = props.child?.master
  if (!master) return []
  const date = (value: string | null) => (value ? formatDate(value) : '')
  return [
    { label: f.birthDate, value: date(master.birthDate) },
    { label: f.address, value: master.address, multiline: true },
    ...(showGroup.value ? [{ label: f.group, value: groupName(master.groupId) }] : []),
    { label: f.careType, value: careTypeName(master.careTypeId) ?? '' },
    { label: f.entryDate, value: date(master.entryDate) },
    { label: f.plannedEntryDate, value: date(master.plannedEntryDate) },
    { label: f.infoMeetingDate, value: date(master.infoMeetingDate) },
    { label: f.schoolStartDate, value: date(master.schoolStartDate) },
    { label: f.primarySchool, value: master.primarySchool },
    { label: f.note, value: master.note, multiline: true },
  ]
})
</script>

<template>
  <ChildrenChildSection
    v-model:editing="editing" :title="creating ? de.children.createTitle : de.children.sections.master"
    :stamp="child?.stamps.master ?? { updatedAt: null, updatedBy: null }" :can-edit="!!child?.canEdit"
  >
    <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div v-for="row in rows" :key="row.label" :class="row.multiline ? 'sm:col-span-2' : ''">
        <dt class="text-xs text-gray-500">{{ row.label }}</dt>
        <dd :class="row.multiline ? 'whitespace-pre-line' : ''">{{ row.value || de.children.noValue }}</dd>
      </div>
    </dl>

    <template #edit>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
        <UFormField :label="f.lastName" required><UInput v-model="form.lastName" maxlength="100" class="w-full" required /></UFormField>
        <UFormField :label="f.firstName" required><UInput v-model="form.firstName" maxlength="100" class="w-full" required /></UFormField>
        <UFormField :label="f.birthDate" required><UInput v-model="form.birthDate" type="date" :max="today" class="w-full" required /></UFormField>
        <UFormField v-if="showGroup && canPickGroup" :label="f.group"><USelect v-model="form.groupId" :items="groupItems" class="w-full" /></UFormField>
        <UFormField :label="f.careType"><USelect v-model="form.careTypeId" :items="careTypeItems" class="w-full" /></UFormField>
        <UFormField :label="f.address" class="sm:col-span-2"><UTextarea v-model="form.address" :rows="3" maxlength="500" class="w-full" /></UFormField>
        <UFormField :label="f.entryDate"><UInput v-model="form.entryDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.plannedEntryDate"><UInput v-model="form.plannedEntryDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.infoMeetingDate"><UInput v-model="form.infoMeetingDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.schoolStartDate"><UInput v-model="form.schoolStartDate" type="date" class="w-full" /></UFormField>
        <UFormField :label="f.primarySchool" class="sm:col-span-2"><UInput v-model="form.primarySchool" maxlength="200" class="w-full" /></UFormField>
        <UFormField :label="f.note" class="sm:col-span-2"><UTextarea v-model="form.note" :rows="3" maxlength="2000" class="w-full" /></UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="creating ? de.children.create : de.common.save" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="cancel" />
        </div>
      </form>
    </template>
  </ChildrenChildSection>
</template>
