<script setup lang="ts">
import { daysInMonth, todayIso, toIsoDate, weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { CalendarEventDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { calendarEventText, calendarLanes, eventRowHeight } from '~/utils/calendarLanes'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort } from '~/utils/format'

/** Year calendar for printing: A4 landscape, January–June on one page, July–December on the next, then the appointment list. */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 8mm; }' }] })

const year = Number(useRoute().params.year)
const { data: calendar, error } = await useFetch<YearCalendarDto>('/api/calendar', { query: { year } })
const eventTime = (event: CalendarEventDto) =>
  event.start === null ? '' : `${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`

const HALVES = [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]]
const secondHalfLabel = `${de.months[6]}–${de.months[11]}`

/**
 * Height of the employee rows so that six months fit one page (px at 96 dpi): the printable height of A4 landscape
 * with 8 mm margins, minus the page header and each month's day header, appointments row and gap. Kept between a
 * still readable minimum and a comfortable maximum; with many employees a month moves to the next page whole.
 */
const PAGE_HEIGHT = 733 - 15 // safety margin
const FIRST_HEADER = 44 // title, legend, groups (measured about 36)
const SECOND_HEADER = 32 // title + "Juli–Dezember"
const MONTH_FIXED = 30 // day header, borders and the gap below the month (measured about 28)
const MIN_ROW = 12
const MAX_ROW = 24
const rowHeight = computed(() => {
  const value = calendar.value
  if (!value) return MAX_ROW
  const rows = Math.max(1, value.employees.length)
  const fits = HALVES.map((months, index) => {
    const fixed = months.reduce((sum, month) => {
      const dates = Array.from({ length: daysInMonth(year, month) }, (_, day) => toIsoDate(year, month, day + 1))
      const events = value.events.filter(event => Number(event.date.slice(5, 7)) === month)
      return sum + MONTH_FIXED + eventRowHeight(calendarLanes(dates, events, calendarEventText, value.autoEvents).laneCount)
    }, 0)
    const room = PAGE_HEIGHT - (index === 0 ? FIRST_HEADER : SECOND_HEADER) - fixed
    return Math.floor(room / (months.length * rows)) - 1 // 1 px border per row
  })
  return Math.min(MAX_ROW, Math.max(MIN_ROW, Math.min(...fits)))
})
</script>

<template>
  <div class="bg-white p-4 text-gray-900 print:p-0">
    <div class="mb-2 flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">{{ de.calendar.printTitle(year) }}</h1>
      <CalendarLegend />
      <PrintActions :file-name="`Jahreskalender-${year}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="calendar">
      <CalendarGroupLegend class="mb-2" :groups="calendar.groups" />
      <!-- Wide enough for 31 readable day columns; A4 landscape (about 1060 px) still fits. -->
      <div class="overflow-x-auto print:overflow-visible">
        <section v-for="(months, half) in HALVES" :key="half" :class="half > 0 ? 'break-before-page' : ''">
          <h2 v-if="half > 0" class="mb-2 mt-4 text-lg font-semibold print:mt-0">
            {{ de.calendar.printTitle(year) }} – {{ secondHalfLabel }}
          </h2>
          <div v-for="month in months" :key="month" class="mb-3 min-w-[1000px] break-inside-avoid print:mb-1">
            <CalendarMonth :calendar="calendar" :month="month" :row-height="rowHeight" />
          </div>
        </section>
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
