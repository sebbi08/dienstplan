<script setup lang="ts">
import { EVENT_VISIBILITIES, type EventVisibility } from '#shared/domain/calendarEvents'
import { formatTime, parseTime } from '#shared/domain/time'
import type { CalendarEventAudienceDto, CalendarEventDto, CalendarEventSaveDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * New appointment for a clicked day, or the clicked existing appointment to change or delete; the same dialog in the
 * year calendar and in the plan. „Wer sieht den Termin?“ must be answered for a new appointment (shared/domain/
 * calendarEvents.ts); the groups and staff to choose from come from the server when the dialog opens.
 */
const props = defineProps<{ event: CalendarEventDto | null; date: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ save: [value: CalendarEventSaveDto]; remove: [] }>()

interface Form {
  date: string; endDate: string; start: string; end: string; title: string; visibility: EventVisibility | null
  groupIds: number[]; employeeIds: number[]
}
const form = reactive<Form>({ date: '', endDate: '', start: '', end: '', title: '', visibility: null, groupIds: [], employeeIds: [] })
const error = ref('')
const audience = ref<CalendarEventAudienceDto | null>(null)
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))

watch(open, async (isOpen) => {
  if (!isOpen) return
  const event = props.event
  Object.assign(form, event
    ? {
        date: event.date, endDate: event.endDate ?? '', start: timeText(event.start), end: timeText(event.end), title: event.title,
        visibility: event.visibility, groupIds: [...event.groupIds], employeeIds: [...event.employeeIds],
      }
    : { date: props.date, endDate: '', start: '', end: '', title: '', visibility: null, groupIds: [], employeeIds: [] })
  error.value = ''
  try {
    audience.value = await $fetch<CalendarEventAudienceDto>('/api/calendar-events/audience')
    // Only what can still be chosen (a deleted group, a person who left or moved is not offered any more).
    const groups = new Set(audience.value.groups.map(group => group.id))
    const people = new Set(audience.value.employees.map(employee => employee.id))
    form.groupIds = form.groupIds.filter(id => groups.has(id))
    form.employeeIds = form.employeeIds.filter(id => people.has(id))
  }
  catch {
    audience.value = { groups: [], employees: [] }
  }
}, { immediate: true })

// A message about the last „Speichern“ goes as soon as something is changed.
watch(form, () => { error.value = '' }, { deep: true })

const visibilityItems =EVENT_VISIBILITIES.map(value => ({
  label: de.calendar.visibilityLabels[value], description: de.calendar.visibilityHints[value], value,
}))
/** Unanswered (null) shows no choice ticked. */
const visibility = computed({
  get: () => form.visibility ?? undefined,
  set: (value: EventVisibility | undefined) => { form.visibility = value ?? null },
})
const groupNames = computed(() => new Map(audience.value?.groups.map(group => [group.id, group.name]) ?? []))

function toggle(list: 'groupIds' | 'employeeIds', id: number, on: boolean | 'indeterminate') {
  form[list] = on === true ? [...new Set([...form[list], id])] : form[list].filter(item => item !== id)
}

/** Empty = no time; undefined = typed but not a valid time. */
const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

function submit() {
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
  if (form.visibility === null) {
    error.value = de.calendar.visibilityRequired
    return
  }
  if (form.visibility === 'groups' && form.groupIds.length === 0) {
    error.value = de.calendar.pickGroups
    return
  }
  if (form.visibility === 'employees' && form.employeeIds.length === 0) {
    error.value = de.calendar.pickEmployees
    return
  }
  emit('save', {
    date: form.date, endDate: form.endDate && form.endDate !== form.date ? form.endDate : null, start, end, title: form.title,
    visibility: form.visibility, groupIds: form.visibility === 'groups' ? form.groupIds : [],
    employeeIds: form.visibility === 'employees' ? form.employeeIds : [],
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
        <UFormField :label="de.calendar.visibility" class="col-span-2" required :help="de.calendar.visibilityAlways">
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
          </div>
        </fieldset>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex gap-2">
          <UButton v-if="event" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" @click="emit('remove')" />
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
