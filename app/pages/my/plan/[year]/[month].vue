<script setup lang="ts">
import { cellFillColor } from '#shared/domain/cells'
import { weekday } from '#shared/domain/dates'
import { formatDuration } from '#shared/domain/time'
import type { MyPlanDayDto, MyPlanDto, MyTimeDto, RecordedDayDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cellFillClasses } from '~/utils/colors'
import { errorMessage } from '~/utils/errors'
import { releasedChangeText } from '~/utils/changes'
import { isCompactMyPlanDay } from '~/utils/dayCards'
import { formatDayShort, formatSpan } from '~/utils/format'
import { plannedSpanLine } from '~/utils/homeOffice'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { data, error } = await useFetch<MyPlanDto>(() => `/api/my/plan/${year.value}/${month.value}`)
const { data: time, refresh: refreshTime } = await useFetch<MyTimeDto>('/api/my/time', { query: { year, month } })
const recordsByDate = computed(() => {
  const map = new Map<string, TimeRecordDto[]>()
  for (const record of time.value?.records ?? []) map.set(record.date, [...(map.get(record.date) ?? []), record])
  return map
})
/** „Erfasst“ of a day as on the admin time page (records plus home office of the tracking range); none = nothing recorded. */
const recordedOf = (date: string): RecordedDayDto | undefined => time.value?.recordedDays[date]
/** The days with something recorded, in order (records, or home office of the tracking range). */
const recordedDates = computed(() => Object.keys(time.value?.recordedDays ?? {}).sort())
/** How many lines the day's time tracking shows (records and home office). */
const recordedLines = (date: string) => (recordsByDate.value.get(date)?.length ?? 0) + (recordedOf(date)?.homeOffice.length ?? 0)

/** admin-created records are "nachgetragen", other admin-changed ones "geändert". */
const recordMarker = (record: TimeRecordDto) => (record.source === 'admin' ? de.time.edited : record.edited ? de.time.changed : null)

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/my/plan/${nextYear}/${nextMonth}`)
}

function changeTitle(day: MyPlanDayDto): string | undefined {
  return releasedChangeText(day.changes)
}

/** The facilities the day's help-out duties are in ("Aushilfe in …"), once each. */
function helpFacilityNames(day: MyPlanDayDto): string[] {
  return [...new Set(day.entries.flatMap(entry => entry.helpFacilityName ?? []))]
}

function fillClass(day: MyPlanDayDto): string {
  const fill = cellFillColor(day.entries)
  return fill ? cellFillClasses[fill] : ''
}

function rowClass(day: MyPlanDayDto): string {
  if (day.changes.length > 0) return 'bg-orange-50'
  if (day.holidayKey || day.closureLabel) return 'bg-blue-50'
  return day.isWeekend ? 'bg-gray-50 text-gray-500' : 'bg-white'
}
</script>

<template>
  <div class="max-w-3xl space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <MonthNav :year="year" :month="month" @change="navigate" />
      <span v-if="data" class="text-gray-600">{{ data.employee.name }}</span>
      <UBadge v-if="data?.release.changeCount" color="warning" variant="soft" :label="de.plan.changesCount(data.release.changeCount)" />
    </div>
    <MyNotifications />
    <LeaveForfeitNotice />
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <TimeMyTimeCard v-if="time?.enabled" :time="time" :refresh="refreshTime" />
    <!-- Phones: one card per day instead of the table; days with nothing on them are one slim line. -->
    <div v-if="data" class="space-y-1.5 md:hidden">
      <template v-for="day in data.days" :key="day.date">
        <div
          v-if="isCompactMyPlanDay(day, time?.enabled ? recordedLines(day.date) : 0)"
          class="flex items-center gap-2 rounded px-2 py-1 text-xs text-gray-500 ring-1 ring-gray-200"
          :class="day.holidayKey || day.closureLabel ? 'bg-blue-50' : 'bg-gray-50'"
        >
          <span class="whitespace-nowrap font-medium">{{ formatDayShort(day.date, day.weekday) }}</span>
          <span v-if="day.holidayKey" class="truncate text-blue-700">{{ de.holidays[day.holidayKey] }}</span>
          <span v-else-if="day.closureLabel" class="truncate text-blue-700">{{ day.closureLabel }}</span>
        </div>
        <div
          v-else class="space-y-1 rounded-lg p-2 text-sm ring-1 ring-gray-200"
          :class="[rowClass(day), day.changes.length ? 'border-l-4 border-orange-400' : '']" :title="changeTitle(day)"
        >
          <div class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-medium">{{ formatDayShort(day.date, day.weekday) }}</span>
            <span v-if="day.holidayKey" class="text-xs text-blue-700">{{ de.holidays[day.holidayKey] }}</span>
            <span v-else-if="day.closureLabel" class="text-xs text-blue-700">{{ day.closureLabel }}</span>
          </div>
          <div v-if="day.entries.length || helpFacilityNames(day).length" class="flex flex-wrap items-center gap-1 rounded px-1 py-0.5" :class="fillClass(day)">
            <PlanEntryChip v-for="entry in day.entries" :key="entry.id" :entry="entry" />
            <span v-for="name in helpFacilityNames(day)" :key="name" class="text-xs text-gray-600">{{ de.myPlan.helpOutIn(name) }}</span>
          </div>
          <div v-if="time?.enabled && recordedOf(day.date)" class="text-xs">
            <span v-for="span in recordedOf(day.date)?.homeOffice ?? []" :key="`${span.start}-${span.end}`" class="mr-2 inline-flex items-center gap-1 text-gray-600">
              <UIcon v-if="!span.away" name="i-lucide-house" class="shrink-0" />{{ plannedSpanLine(span) }}
            </span>
            <span v-for="record in recordsByDate.get(day.date) ?? []" :key="record.id" class="mr-2 inline-block">
              {{ formatSpan(record) }} <span v-if="recordMarker(record)" class="text-amber-700">({{ recordMarker(record) }})</span> <TimeOfflineMarks :record="record" />
            </span>
            <span class="font-semibold">{{ de.time.recorded }}: {{ formatDuration(recordedOf(day.date)!.recordedMinutes) }}</span>
          </div>
          <div v-if="day.info1" class="text-xs">{{ day.info1 }}</div>
          <div v-if="day.info2" class="text-xs">{{ day.info2 }}</div>
          <PlanAutoEvents :events="day.autoEvents" />
        </div>
      </template>
    </div>
    <table v-if="data" class="hidden w-full overflow-hidden rounded-lg text-sm ring-1 ring-gray-200 md:table">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.plan.date }}</th>
          <th class="px-3 py-2">{{ de.myPlan.shift }}</th>
          <th v-if="time?.enabled" class="px-3 py-2">{{ de.time.records }}</th>
          <th class="px-3 py-2">{{ de.plan.info1 }}</th>
          <th class="px-3 py-2">{{ de.plan.info2 }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="day in data.days" :key="day.date" class="border-t border-gray-200" :class="rowClass(day)" :title="changeTitle(day)">
          <td class="px-3 py-1.5 font-medium" :class="day.changes.length ? 'border-l-4 border-orange-400' : ''">
            {{ formatDayShort(day.date, day.weekday) }}
            <div v-if="day.holidayKey" class="text-xs font-normal text-blue-700">{{ de.holidays[day.holidayKey] }}</div>
            <div v-else-if="day.closureLabel" class="text-xs font-normal text-blue-700">{{ day.closureLabel }}</div>
          </td>
          <td class="px-3 py-1.5" :class="fillClass(day)">
            <div class="flex flex-wrap items-center gap-1">
              <PlanEntryChip v-for="entry in day.entries" :key="entry.id" :entry="entry" />
              <span v-for="name in helpFacilityNames(day)" :key="name" class="text-xs text-gray-600">{{ de.myPlan.helpOutIn(name) }}</span>
            </div>
          </td>
          <td v-if="time?.enabled" class="px-3 py-1.5 text-xs">
            <div v-for="span in recordedOf(day.date)?.homeOffice ?? []" :key="`${span.start}-${span.end}`" class="flex items-center gap-1 text-gray-600">
              <UIcon v-if="!span.away" name="i-lucide-house" class="shrink-0" />{{ plannedSpanLine(span) }}
            </div>
            <div v-for="record in recordsByDate.get(day.date) ?? []" :key="record.id">
              {{ formatSpan(record) }} <span v-if="recordMarker(record)" class="text-amber-700">({{ recordMarker(record) }})</span> <TimeOfflineMarks :record="record" />
            </div>
            <div v-if="recordedOf(day.date)" class="font-semibold">
              {{ de.time.recorded }}: {{ formatDuration(recordedOf(day.date)!.recordedMinutes) }}
            </div>
          </td>
          <td class="px-3 py-1.5 text-xs">{{ day.info1 }}</td>
          <td class="px-3 py-1.5 text-xs">
            {{ day.info2 }}
            <PlanAutoEvents :events="day.autoEvents" :class="day.info2 ? 'mt-0.5' : ''" />
          </td>
        </tr>
      </tbody>
    </table>
    <!-- Stamped times are live: shown even while the month's plan is not released. -->
    <table v-else-if="time?.enabled && recordedDates.length" class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.plan.date }}</th>
          <th class="px-3 py-2">{{ de.time.records }}</th>
          <th class="px-3 py-2 text-right">{{ de.time.recorded }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="date in recordedDates" :key="date" class="border-t border-gray-200 align-top">
          <td class="whitespace-nowrap px-3 py-1.5 font-medium">{{ formatDayShort(date, weekday(date)) }}</td>
          <td class="px-3 py-1.5 text-xs">
            <div v-for="span in recordedOf(date)?.homeOffice ?? []" :key="`${span.start}-${span.end}`" class="flex items-center gap-1 text-gray-600">
              <UIcon v-if="!span.away" name="i-lucide-house" class="shrink-0" />{{ plannedSpanLine(span) }}
            </div>
            <div v-for="record in recordsByDate.get(date) ?? []" :key="record.id">
              {{ formatSpan(record) }} <span v-if="recordMarker(record)" class="text-amber-700">({{ recordMarker(record) }})</span> <TimeOfflineMarks :record="record" />
            </div>
          </td>
          <td class="px-3 py-1.5 text-right font-semibold">{{ formatDuration(recordedOf(date)!.recordedMinutes) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
