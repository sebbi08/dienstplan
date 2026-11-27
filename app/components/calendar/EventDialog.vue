<script setup lang="ts">
import { EVENT_VISIBILITIES, eventLastDay, type EventVisibility } from '#shared/domain/calendarEvents'
import { todayIso } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { CalendarEventAudienceDto, CalendarEventDto, CalendarEventSaveDto, RequirementTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * New appointment for a clicked day, or the clicked existing appointment to change or delete; the same dialog in the
 * year calendar and in the plan. „Wer sieht den Termin?“ must be answered for a new appointment (shared/domain/
 * calendarEvents.ts); the groups and staff to choose from come from the server when the dialog opens.
 *
 * „Pflichttermin“ (only for whoever may enter Pflichttermine, employees.edit): the kind, and „Für wen gilt er?“ in place
 * of „Wer sieht den Termin?“ – the participants see it, so „Nur Leitung und Träger“ is not offered. From the last day on
 * „Teilnahme bestätigen“ opens the attendance dialog (emit `attendance`). Without the right a Pflichttermin is shown,
 * not changed (the server refuses it too).
 */
const props = defineProps<{ event: CalendarEventDto | null; date: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ save: [value: CalendarEventSaveDto]; remove: []; attendance: [] }>()

const { can } = useCan()
const mayRecord = computed(() => can('employees.edit'))
/** A Pflichttermin someone without the right opened: shown, not changed. */
const locked = computed(() => !!props.event?.requirement && !mayRecord.value)

interface Form {
  date: string; endDate: string; start: string; end: string; title: string; visibility: EventVisibility | null
  groupIds: number[]; employeeIds: number[]; requirement: boolean; requirementTypeId: number | null
}
const form = reactive<Form>({
  date: '', endDate: '', start: '', end: '', title: '', visibility: null, groupIds: [], employeeIds: [], requirement: false, requirementTypeId: null,
})
const error = ref('')
const audience = ref<CalendarEventAudienceDto | null>(null)
const kinds = ref<RequirementTypeDto[] | null>(null)
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))

watch(open, async (isOpen) => {
  if (!isOpen) return
  const event = props.event
  Object.assign(form, event
    ? {
        date: event.date, endDate: event.endDate ?? '', start: timeText(event.start), end: timeText(event.end), title: event.title,
        visibility: event.visibility, groupIds: [...event.groupIds], employeeIds: [...event.employeeIds],
        requirement: !!event.requirement, requirementTypeId: event.requirement?.typeId ?? null,
      }
    : {
        date: props.date, endDate: '', start: '', end: '', title: '', visibility: null, groupIds: [], employeeIds: [],
        requirement: false, requirementTypeId: null,
      })
  // A Pflichttermin left with „Nur Leitung und Träger“ (its list emptied by deletions) asks for a new choice.
  if (form.requirement && form.visibility === 'leaders') form.visibility = null
  error.value = ''
  audience.value = null
  kinds.value = null
  if (mayRecord.value) {
    $fetch<RequirementTypeDto[]>('/api/requirement-types').then((list) => { kinds.value = list }).catch(() => { kinds.value = [] })
  }
  try {
    audience.value = await $fetch<CalendarEventAudienceDto>('/api/calendar-events/audience', { query: event ? { eventId: event.id } : {} })
    // Only what can still be chosen; people who left stay visible as „ausgeschieden“ (former) and go on saving.
    const groups = new Set(audience.value.groups.map(group => group.id))
    const people = new Set(audience.value.employees.map(employee => employee.id))
    form.groupIds = form.groupIds.filter(id => groups.has(id))
    form.employeeIds = form.employeeIds.filter(id => people.has(id))
  }
  catch {
    audience.value = { groups: [], employees: [], former: [] }
  }
}, { immediate: true })

// A message about the last „Speichern“ goes as soon as something is changed.
watch(form, () => { error.value = '' }, { deep: true })
// „Pflichttermin“ ticked: „Nur Leitung und Träger“ is no choice for participants.
watch(() => form.requirement, (on) => { if (on && form.visibility === 'leaders') form.visibility = null })

const visibilityItems = computed(() => (form.requirement
  ? EVENT_VISIBILITIES.filter(value => value !== 'leaders').map(value => ({
      label: de.eventRequirements.participantLabels[value as Exclude<EventVisibility, 'leaders'>],
      description: de.eventRequirements.participantHints[value as Exclude<EventVisibility, 'leaders'>], value,
    }))
  : EVENT_VISIBILITIES.map(value => ({ label: de.calendar.visibilityLabels[value], description: de.calendar.visibilityHints[value], value }))))
const kindItems = computed(() => (kinds.value ?? []).map(kind => ({ label: kind.name, value: kind.id })))
const requirementTypeId = computed({
  get: () => form.requirementTypeId ?? undefined,
  set: (value: number | undefined) => { form.requirementTypeId = value ?? null },
})
/** Unanswered (null) shows no choice ticked. */
const visibility = computed({
  get: () => form.visibility ?? undefined,
  set: (value: EventVisibility | undefined) => { form.visibility = value ?? null },
})
const groupNames = computed(() => new Map(audience.value?.groups.map(group => [group.id, group.name]) ?? []))
/** People on the list who left: shown ticked and greyed, taken off the list on saving. */
const former = computed(() => audience.value?.former ?? [])
/** Only people who left were chosen: saving makes it „Nur Leitung und Träger“ (as deleting them would). */
const onlyFormer = computed(() => form.visibility === 'employees' && form.employeeIds.length === 0 && former.value.length > 0)
/** A Pflichttermin whose attendance was confirmed: changing the date moves its entries (said in the dialog). */
const confirmed = computed(() => !!props.event?.requirement?.confirmedAt)
/** „Teilnahme bestätigen“: a saved Pflichttermin from its last day on. */
const canConfirm = computed(() => !!props.event?.requirement && mayRecord.value && eventLastDay(props.event) <= todayIso())

function toggle(list: 'groupIds' | 'employeeIds', id: number, on: boolean | 'indeterminate') {
  form[list] = on === true ? [...new Set([...form[list], id])] : form[list].filter(item => item !== id)
}

/** Empty = no time; undefined = typed but not a valid time. */
const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

function submit() {
  if (locked.value) return
  const start = optionalTime(form.start)
  const end = optionalTime(form.end)
  if (start === undefined || end === undefined) {
    error.value = de.common.invalidTime
    return
  }
  if (form.endDate && form.endDate < form.date) {
    error.value = de.calendar.endBeforeStart
    return
  }
  if (form.requirement && form.requirementTypeId === null) {
    error.value = de.eventRequirements.typeRequired
    return
  }
  if (form.visibility === null) {
    error.value = form.requirement ? de.eventRequirements.participantsRequired : de.calendar.visibilityRequired
    return
  }
  if (form.visibility === 'groups' && form.groupIds.length === 0) {
    error.value = de.calendar.pickGroups
    return
  }
  if (form.visibility === 'employees' && form.employeeIds.length === 0 && (!onlyFormer.value || form.requirement)) {
    error.value = onlyFormer.value ? de.eventRequirements.formerOnly : de.calendar.pickEmployees
    return
  }
  const visibility = onlyFormer.value ? 'leaders' : form.visibility
  emit('save', {
    date: form.date, endDate: form.endDate && form.endDate !== form.date ? form.endDate : null, start, end, title: form.title,
    visibility, groupIds: visibility === 'groups' ? form.groupIds : [],
    employeeIds: visibility === 'employees' ? form.employeeIds : [],
    // Only whoever may enter Pflichttermine sends the choice; for anybody else it stays as it is.
    ...(mayRecord.value ? { requirementTypeId: form.requirement ? form.requirementTypeId : null } : {}),
  })
}
</script>

<template>
  <UModal v-model:open="open" :title="event ? de.calendar.editEvent : de.calendar.addEvent">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.calendar.date"><DateTextInput v-model="form.date" :label="de.calendar.date" class="w-full" required /></UFormField>
        <UFormField :label="de.calendar.endDate">
          <DateTextInput v-model="form.endDate" :label="de.calendar.endDate" :min="form.date || undefined" class="w-full" />
        </UFormField>
        <p class="col-span-2 -mt-1 text-xs text-gray-500">{{ de.calendar.endDateHint }}</p>
        <UFormField :label="de.calendar.from"><TimeInput v-model="form.start" /></UFormField>
        <UFormField :label="de.calendar.to"><TimeInput v-model="form.end" /></UFormField>
        <UFormField :label="de.calendar.title2" class="col-span-2">
          <UInput v-model="form.title" maxlength="200" :placeholder="de.calendar.titlePlaceholder" class="w-full" required autofocus />
        </UFormField>
        <div v-if="mayRecord" class="col-span-2 space-y-2 rounded-md bg-amber-50 p-2 ring-1 ring-amber-200">
          <UCheckbox v-model="form.requirement" :label="de.eventRequirements.checkbox" :description="de.eventRequirements.checkboxHint" />
          <UFormField v-if="form.requirement" :label="de.eventRequirements.type" required>
            <p v-if="!kinds" class="text-sm text-gray-500">{{ de.eventRequirements.typesLoading }}</p>
            <USelect
              v-else v-model="requirementTypeId" :items="kindItems" :placeholder="de.eventRequirements.typePlaceholder" class="w-full"
              :aria-label="de.eventRequirements.type"
            />
          </UFormField>
          <p v-if="confirmed" class="text-xs text-amber-900">{{ de.eventRequirements.confirmedChangeHint }}</p>
        </div>
        <p v-else-if="event?.requirement" class="col-span-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {{ de.eventRequirements.badge(event.requirement.typeName) }}. {{ de.eventRequirements.lockedHint }}
        </p>
        <UFormField
          :label="form.requirement ? de.eventRequirements.participants : de.calendar.visibility" class="col-span-2" required
          :help="form.requirement ? de.eventRequirements.participantsHint : de.calendar.visibilityAlways"
        >
          <URadioGroup v-model="visibility" :items="visibilityItems" />
        </UFormField>
        <fieldset v-if="form.visibility === 'groups'" class="col-span-2 rounded-md bg-gray-50 p-2">
          <legend class="sr-only">{{ de.calendar.visibilityLabels.groups }}</legend>
          <p v-if="!audience" class="text-sm text-gray-500">{{ de.calendar.audienceLoading }}</p>
          <p v-else-if="!audience.groups.length" class="text-sm text-gray-500">{{ de.calendar.noGroups }}</p>
          <div v-else class="grid gap-1 sm:grid-cols-2">
            <UCheckbox
              v-for="group in audience.groups" :key="group.id" :label="group.name" class="min-h-9 items-center"
              :model-value="form.groupIds.includes(group.id)" @update:model-value="toggle('groupIds', group.id, $event)"
            />
          </div>
        </fieldset>
        <fieldset v-if="form.visibility === 'employees'" class="col-span-2 rounded-md bg-gray-50 p-2">
          <legend class="sr-only">{{ de.calendar.visibilityLabels.employees }}</legend>
          <p v-if="!audience" class="text-sm text-gray-500">{{ de.calendar.audienceLoading }}</p>
          <div v-else class="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            <UCheckbox
              v-for="employee in audience.employees" :key="employee.id" class="min-h-9 items-center"
              :label="employee.name" :description="employee.groupId === null ? undefined : groupNames.get(employee.groupId)"
              :model-value="form.employeeIds.includes(employee.id)" @update:model-value="toggle('employeeIds', employee.id, $event)"
            />
            <UCheckbox
              v-for="person in former" :key="`former-${person.id}`" class="min-h-9 items-center opacity-70"
              :label="de.calendar.formerEmployee(person.name)" :model-value="true" disabled
            />
          </div>
          <p v-if="audience && former.length" class="mt-2 text-xs text-amber-800">
            {{ de.calendar.formerNote(former.map(person => person.name).join(', ')) }}
            <template v-if="onlyFormer && !form.requirement">{{ de.calendar.formerOnlyNote }}</template>
          </p>
        </fieldset>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex flex-wrap gap-2">
          <UButton v-if="event && !locked" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" @click="emit('remove')" />
          <UButton
            v-if="canConfirm" color="primary" variant="outline" icon="i-lucide-user-check" :label="de.eventRequirements.confirm"
            @click="emit('attendance')"
          />
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="locked ? de.common.close : de.common.cancel" @click="open = false" />
          <UButton v-if="!locked" type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
