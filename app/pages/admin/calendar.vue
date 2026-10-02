<script setup lang="ts">
import { parseIsoDate, todayIso, weekday } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { CalendarEventDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'

/** Admin-only year calendar (absences from the plan) with the admin's own appointments. */
const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const { data: calendar, refresh } = await useFetch<YearCalendarDto>('/api/calendar', { query: { year } })
const run = useAction(refresh)
const confirm = useConfirm()
const toast = useToast()

const emptyForm = () => ({ id: null as number | null, date: todayIso(), start: '', end: '', title: '' })
const form = reactive(emptyForm())
const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
const eventTime = (event: CalendarEventDto) =>
  event.start === null ? '' : `${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`

function edit(event: CalendarEventDto) {
  Object.assign(form, { id: event.id, date: event.date, start: timeText(event.start), end: timeText(event.end), title: event.title })
}

function reset() {
  Object.assign(form, emptyForm())
}

/** Empty = no time; undefined = typed but not a valid time. */
const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

async function save() {
  const start = optionalTime(form.start)
  const end = optionalTime(form.end)
  if (start === undefined || end === undefined) {
    toast.add({ title: de.common.invalidTime, color: 'error' })
    return
  }
  const body = { date: form.date, start, end, title: form.title }
  const ok = await run(() => form.id
    ? $fetch<unknown>(`/api/calendar-events/${form.id}`, { method: 'PUT', body })
    : $fetch<unknown>('/api/calendar-events', { method: 'POST', body }), de.common.saved)
  if (ok) {
    const saved = parseIsoDate(form.date).year
    reset()
    year.value = saved
  }
}

async function remove(event: CalendarEventDto) {
  if (await confirm(de.calendar.confirmDelete)) run(() => $fetch<unknown>(`/api/calendar-events/${event.id}`, { method: 'DELETE' }), de.common.deleted)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.calendar.title }}</h1>
      <YearNav v-model="year" />
      <UButton
        class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print"
        :to="`/admin/print/calendar/${year}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ de.year.adminOnly }}</p>
    <CalendarLegend />

    <div v-if="calendar" class="space-y-3 overflow-x-auto">
      <div v-for="month in 12" :key="month" class="min-w-[900px] rounded-lg bg-white">
        <CalendarMonth :calendar="calendar" :month="month" />
      </div>
    </div>

    <section class="max-w-4xl space-y-3">
      <h2 class="text-lg font-semibold">{{ de.calendar.eventList }}</h2>
      <p v-if="!calendar?.events.length" class="text-sm text-gray-500">{{ de.calendar.noEvents }}</p>
      <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
        <thead class="bg-gray-100 text-left text-xs text-gray-600">
          <tr>
            <th class="px-3 py-2">{{ de.calendar.date }}</th><th class="px-3 py-2">{{ de.calendar.time }}</th>
            <th class="px-3 py-2">{{ de.calendar.title2 }}</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in calendar.events" :key="event.id" class="border-t border-gray-100" :class="form.id === event.id ? 'bg-sky-50' : ''">
            <td class="whitespace-nowrap px-3 py-2">{{ formatDayShort(event.date, weekday(event.date)) }}{{ event.date.slice(0, 4) }}</td>
            <td class="whitespace-nowrap px-3 py-2">{{ eventTime(event) }}</td>
            <td class="px-3 py-2">{{ event.title }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="edit(event)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="remove(event)" />
            </td>
          </tr>
        </tbody>
      </table>

      <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-5 sm:items-end" @submit.prevent="save">
        <h3 class="font-semibold sm:col-span-5">{{ form.id ? de.calendar.editEvent : de.calendar.addEvent }}</h3>
        <UFormField :label="de.calendar.date"><UInput v-model="form.date" type="date" class="w-full" required /></UFormField>
        <UFormField :label="de.calendar.from"><TimeInput v-model="form.start" /></UFormField>
        <UFormField :label="de.calendar.to"><TimeInput v-model="form.end" /></UFormField>
        <UFormField :label="de.calendar.title2" class="sm:col-span-2">
          <UInput v-model="form.title" maxlength="200" :placeholder="de.calendar.titlePlaceholder" class="w-full" required />
        </UFormField>
        <div class="flex gap-2 sm:col-span-5">
          <UButton type="submit" :icon="form.id ? 'i-lucide-check' : 'i-lucide-plus'" :label="form.id ? de.common.save : de.common.add" />
          <UButton v-if="form.id" color="neutral" variant="ghost" :label="de.common.cancel" @click="reset" />
        </div>
      </form>
    </section>
  </div>
</template>
