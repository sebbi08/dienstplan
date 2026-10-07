<script setup lang="ts">
import { cellFillColor } from '#shared/domain/cells'
import { weekday } from '#shared/domain/dates'
import { formatDuration } from '#shared/domain/time'
import { recordedMinutes } from '#shared/domain/timeRecords'
import type { MyPlanDayDto, MyPlanDto, MyTimeDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cellFillClasses } from '~/utils/colors'
import { errorMessage } from '~/utils/errors'
import { releasedChangeText } from '~/utils/changes'
import { formatDayShort, formatSpan } from '~/utils/format'

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

/** admin-created records are "nachgetragen", other admin-changed ones "geändert". */
const recordMarker = (record: TimeRecordDto) => (record.source === 'admin' ? de.time.edited : record.edited ? de.time.changed : null)

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/my/plan/${nextYear}/${nextMonth}`)
}

function changeTitle(day: MyPlanDayDto): string | undefined {
  return releasedChangeText(day.changes)
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
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <TimeMyTimeCard v-if="time?.enabled" :time="time" :refresh="refreshTime" />
    <table v-if="data" class="w-full overflow-hidden rounded-lg text-sm ring-1 ring-gray-200">
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
            <div class="flex flex-wrap gap-1">
              <PlanEntryChip v-for="entry in day.entries" :key="entry.id" :entry="entry" />
            </div>
          </td>
          <td v-if="time?.enabled" class="px-3 py-1.5 text-xs">
            <div v-for="record in recordsByDate.get(day.date) ?? []" :key="record.id">
              {{ formatSpan(record) }} <span v-if="recordMarker(record)" class="text-amber-700">({{ recordMarker(record) }})</span>
            </div>
            <div v-if="recordsByDate.get(day.date)?.length" class="font-semibold">
              {{ de.time.recorded }}: {{ formatDuration(recordedMinutes(recordsByDate.get(day.date)!)) }}
            </div>
          </td>
          <td class="px-3 py-1.5 text-xs">{{ day.info1 }}</td>
          <td class="px-3 py-1.5 text-xs">{{ day.info2 }}</td>
        </tr>
      </tbody>
    </table>
    <!-- Stamped times are live: shown even while the month's plan is not released. -->
    <table v-else-if="time?.enabled && recordsByDate.size" class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.plan.date }}</th>
          <th class="px-3 py-2">{{ de.time.records }}</th>
          <th class="px-3 py-2 text-right">{{ de.time.recorded }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="[date, records] in recordsByDate" :key="date" class="border-t border-gray-200 align-top">
          <td class="whitespace-nowrap px-3 py-1.5 font-medium">{{ formatDayShort(date, weekday(date)) }}</td>
          <td class="px-3 py-1.5 text-xs">
            <div v-for="record in records" :key="record.id">
              {{ formatSpan(record) }} <span v-if="recordMarker(record)" class="text-amber-700">({{ recordMarker(record) }})</span>
            </div>
          </td>
          <td class="px-3 py-1.5 text-right font-semibold">{{ formatDuration(recordedMinutes(records)) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
