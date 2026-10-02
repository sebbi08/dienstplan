<script setup lang="ts">
import { todayIso, weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { CalendarEventDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort } from '~/utils/format'

/** Year calendar for printing: A4 landscape, three months per page, then the appointment list. */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 10mm; }' }] })

const year = Number(useRoute().params.year)
const { data: calendar, error } = await useFetch<YearCalendarDto>('/api/calendar', { query: { year } })
const eventTime = (event: CalendarEventDto) =>
  event.start === null ? '' : `${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`

function print() {
  window.print()
}
</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-2 flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">{{ de.calendar.printTitle(year) }}</h1>
      <CalendarLegend />
      <UButton class="ml-auto print:hidden" icon="i-lucide-printer" :label="de.plan.printNow" @click="print" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="calendar">
      <!-- Wide enough for 31 readable day columns; A4 landscape (about 1050 px) still fits. -->
      <div class="overflow-x-auto print:overflow-visible">
        <div
          v-for="month in 12" :key="month" class="mb-3 min-w-[1000px] break-inside-avoid"
          :class="month % 3 === 0 && month < 12 ? 'break-after-page' : ''"
        >
          <CalendarMonth :calendar="calendar" :month="month" />
        </div>
      </div>
      <section class="break-before-page">
        <h2 class="mb-2 text-lg font-semibold">{{ de.calendar.eventList }} {{ year }}</h2>
        <p v-if="!calendar.events.length" class="text-sm text-gray-600">{{ de.calendar.noEvents }}</p>
        <table v-else class="w-full border-collapse text-sm">
          <thead>
            <tr class="text-left">
              <th class="border border-gray-400 px-2 py-1">{{ de.calendar.date }}</th>
              <th class="border border-gray-400 px-2 py-1">{{ de.calendar.time }}</th>
              <th class="border border-gray-400 px-2 py-1">{{ de.calendar.title2 }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in calendar.events" :key="event.id" class="break-inside-avoid">
              <td class="whitespace-nowrap border border-gray-400 px-2 py-1">{{ formatDayShort(event.date, weekday(event.date)) }}{{ year }}</td>
              <td class="whitespace-nowrap border border-gray-400 px-2 py-1">{{ eventTime(event) }}</td>
              <td class="border border-gray-400 px-2 py-1">{{ event.title }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
    </template>
  </div>
</template>
