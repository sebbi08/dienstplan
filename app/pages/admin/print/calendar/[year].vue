<script setup lang="ts">
import { todayIso, weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { CalendarEventDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { calendarPrintChoice, calendarPrintItems, calendarPrintLayout, calendarPrintSections, monthEventHeights } from '~/utils/calendarPrint'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort } from '~/utils/format'

/**
 * Year calendar for printing, A4 landscape: per group (all groups one after another, or the one in "?group=3") its
 * people on half-year pages (January–June, July–December; a quarter per page when a group is too large), then the
 * appointment list once. The appointments row is the same in every group.
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 6mm; }' }] })

const route = useRoute()
const router = useRouter()
const year = Number(route.params.year)
const { data: calendar, error } = await useFetch<YearCalendarDto>('/api/calendar', { query: { year } })
const eventTime = (event: CalendarEventDto) =>
  event.start === null ? '' : `${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`

// "?group=3" or "?group=none"; a group without people (or deleted) prints, and shows in the select, all groups.
const printChoice = computed(() => (calendar.value ? calendarPrintChoice(calendar.value, route.query.group) : 'all'))
const choice = computed({
  get: () => String(printChoice.value),
  set: value => router.replace({ query: value === 'all' ? {} : { group: value } }),
})
const groupItems = computed(() => (calendar.value ? calendarPrintItems(calendar.value, de.calendar.printAllGroups, de.calendar.printNoGroup) : []))
const search = computed(() => (printChoice.value === 'all' ? '' : `?group=${printChoice.value}`))

const eventHeights = computed(() => (calendar.value ? monthEventHeights(calendar.value) : []))
/** Per section its pages: the months of each page and the row height that lets them fit. */
const sections = computed(() => {
  const value = calendar.value
  if (!value) return []
  return calendarPrintSections(value, printChoice.value, de.calendar.printNoGroup).map((section) => {
    const { monthsPerPage, rowHeight } = calendarPrintLayout(section.employees.length, eventHeights.value)
    const pages = Array.from({ length: 12 / monthsPerPage }, (_, index) =>
      Array.from({ length: monthsPerPage }, (_, month) => index * monthsPerPage + month + 1))
    return { ...section, rowHeight, pages, calendar: { ...value, employees: section.employees } }
  })
})
const pageTitle = (label: string | null, months: number[]) =>
  [de.calendar.printTitle(year), label, `${de.months[months[0]! - 1]}–${de.months[months.at(-1)! - 1]}`].filter(Boolean).join(' – ')

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const fileName = computed(() => {
  const name = printChoice.value === 'none' ? de.calendar.printNoGroup : calendar.value?.groups.find(group => group.id === printChoice.value)?.name
  return `Jahreskalender-${year}${name ? `-${name.replace(/[äöüÄÖÜß]/g, letter => UMLAUTS[letter]!)}` : ''}`
})
</script>

<template>
  <div class="bg-white p-4 text-gray-900 print:p-0">
    <div class="mb-3 flex flex-wrap items-center gap-3 print:hidden">
      <h1 class="text-xl font-semibold">{{ de.calendar.printTitle(year) }}</h1>
      <USelect
        v-if="calendar?.groups.length" v-model="choice" :items="groupItems" class="w-56"
        :aria-label="de.calendar.printGroupLabel"
      />
      <PrintActions :file-name="fileName" :search="search" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="calendar">
      <!-- Wide enough for 31 readable day columns; A4 landscape (about 1060 px) still fits. -->
      <div class="overflow-x-auto print:overflow-visible">
        <template v-for="(section, sectionIndex) in sections" :key="section.key">
          <section
            v-for="(months, pageIndex) in section.pages" :key="pageIndex"
            :class="sectionIndex + pageIndex > 0 ? 'mt-6 break-before-page print:mt-0' : ''"
          >
            <!-- Every page says what it shows; the legend explains the colours on each sheet. -->
            <div class="mb-1 flex flex-wrap items-baseline gap-x-4 gap-y-1" data-print-head>
              <h2 class="text-lg font-semibold">{{ pageTitle(section.label, months) }}</h2>
              <CalendarLegend />
            </div>
            <div v-for="month in months" :key="month" class="mb-3 min-w-[1000px] break-inside-avoid print:mb-1">
              <CalendarMonth :calendar="section.calendar" :month="month" :row-height="section.rowHeight" />
            </div>
          </section>
        </template>
      </div>
      <section class="mt-6 break-before-page print:mt-0">
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
