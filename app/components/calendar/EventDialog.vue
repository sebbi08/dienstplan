<script setup lang="ts">
import { formatTime, parseTime } from '#shared/domain/time'
import type { CalendarEventDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** New appointment for a clicked day, or the clicked existing appointment to change or delete. */
const props = defineProps<{ event: CalendarEventDto | null; date: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  save: [value: { date: string; start: number | null; end: number | null; title: string; visibleToStaff: boolean }]
  remove: []
}>()

// visibleToStaff starts unanswered for a new appointment: the Leitung has to decide it each time.
const form = reactive<{ date: string; start: string; end: string; title: string; visibleToStaff: boolean | null }>({
  date: '', start: '', end: '', title: '', visibleToStaff: null,
})
const error = ref('')
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))

watch(open, (isOpen) => {
  if (!isOpen) return
  const event = props.event
  Object.assign(form, event
    ? { date: event.date, start: timeText(event.start), end: timeText(event.end), title: event.title, visibleToStaff: event.visibleToStaff }
    : { date: props.date, start: '', end: '', title: '', visibleToStaff: null })
  error.value = ''
})

const visibilityItems = [{ label: de.calendar.visibleYes, value: 'yes' }, { label: de.calendar.visibleNo, value: 'no' }]

/** Empty = no time; undefined = typed but not a valid time. */
const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

function submit() {
  const start = optionalTime(form.start)
  const end = optionalTime(form.end)
  if (start === undefined || end === undefined) {
    error.value = de.common.invalidTime
    return
  }
  if (form.visibleToStaff === null) {
    error.value = de.calendar.visibilityRequired
    return
  }
  emit('save', { date: form.date, start, end, title: form.title, visibleToStaff: form.visibleToStaff })
}
</script>

<template>
  <UModal v-model:open="open" :title="event ? de.calendar.editEvent : de.calendar.addEvent">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.calendar.date" class="col-span-2"><DateTextInput v-model="form.date" :label="de.calendar.date" class="w-full" required /></UFormField>
        <UFormField :label="de.calendar.from"><TimeInput v-model="form.start" /></UFormField>
        <UFormField :label="de.calendar.to"><TimeInput v-model="form.end" /></UFormField>
        <UFormField :label="de.calendar.title2" class="col-span-2">
          <UInput v-model="form.title" maxlength="200" :placeholder="de.calendar.titlePlaceholder" class="w-full" required autofocus />
        </UFormField>
        <UFormField :label="de.calendar.visibleToStaff" class="col-span-2" required>
          <URadioGroup
            :model-value="form.visibleToStaff === null ? undefined : form.visibleToStaff ? 'yes' : 'no'" orientation="horizontal"
            :items="visibilityItems" @update:model-value="form.visibleToStaff = $event === 'yes'"
          />
        </UFormField>
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
