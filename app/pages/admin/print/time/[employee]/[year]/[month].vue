<script setup lang="ts">
import { todayIso, toIsoDate, daysInMonth } from '#shared/domain/dates'
import { formatDuration, formatSignedDuration } from '#shared/domain/time'
import type { EmployeeDetailDto, TimeMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort, formatHours, formatSpan, monthTitle } from '~/utils/format'
import { DEVIATION_MINUTES, recordedDifference } from '~/utils/timeSheet'

/** Monthly time sheet of one employee for printing (admin only): plan, records, Ist, difference, reason, totals. */
definePageMeta({ layout: false })

const route = useRoute()
const employeeId = Number(route.params.employee)
const year = Number(route.params.year)
const month = Number(route.params.month)
const { data, error } = await useFetch<TimeMonthDto>('/api/time-records', { query: { employeeId, year, month } })
const { data: employee } = await useFetch<EmployeeDetailDto>(`/api/employees/${employeeId}`)

/** Weekly hours valid at the end of the printed month. */
const weeklyMinutes = computed(() => {
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  return employee.value?.hours.filter(period => period.validFrom <= monthEnd).at(-1)?.weeklyMinutes ?? null
})
const totals = computed(() => {
  const days = data.value?.days ?? []
  const target = days.reduce((sum, day) => sum + day.target, 0)
  const counted = days.reduce((sum, day) => sum + day.counted, 0)
  return { target, counted, delta: counted - target }
})

</script>

<template>
  <div class="mx-auto max-w-4xl bg-white p-6 text-gray-900">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">{{ de.time.printTitle(data?.employee.name ?? '', monthTitle(year, month)) }}</h1>
      <span v-if="weeklyMinutes !== null" class="text-sm text-gray-600">{{ de.time.weeklyHours(formatHours(weeklyMinutes)) }}</span>
      <PrintActions :file-name="`Stempelzeiten-${employee?.name ?? employeeId}-${year}-${String(month).padStart(2, '0')}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="data">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr class="text-left">
            <th class="border border-gray-400 px-1.5 py-1">{{ de.plan.date }}</th>
            <th class="border border-gray-400 px-1.5 py-1">{{ de.time.planned }}</th>
            <th class="border border-gray-400 px-1.5 py-1">{{ de.time.records }}</th>
            <th class="border border-gray-400 px-1.5 py-1 text-right">{{ de.time.recorded }}</th>
            <th class="border border-gray-400 px-1.5 py-1 text-right">{{ de.time.difference }}</th>
            <th class="border border-gray-400 px-1.5 py-1">{{ de.time.reason }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in data.days" :key="day.date" class="break-inside-avoid align-top" :class="day.isWeekend || day.holidayKey ? 'bg-gray-100' : ''">
            <td class="whitespace-nowrap border border-gray-400 px-1.5 py-0.5">{{ formatDayShort(day.date, day.weekday) }}</td>
            <td class="border border-gray-400 px-1.5 py-0.5">{{ day.plan === '—' ? '' : day.plan }}</td>
            <td class="border border-gray-400 px-1.5 py-0.5">
              <span v-for="(record, index) in day.records" :key="record.id">
                {{ index > 0 ? ' · ' : '' }}{{ formatSpan(record) }}<template v-if="record.edited"> ({{ record.source === 'admin' ? de.time.edited : de.time.changed }})</template>
              </span>
            </td>
            <td class="whitespace-nowrap border border-gray-400 px-1.5 py-0.5 text-right">{{ day.records.length ? formatDuration(day.recordedMinutes) : '' }}</td>
            <td class="whitespace-nowrap border border-gray-400 px-1.5 py-0.5 text-right" :class="Math.abs(recordedDifference(day) ?? 0) > DEVIATION_MINUTES ? 'font-semibold' : ''">
              {{ recordedDifference(day) === null ? '' : formatSignedDuration(recordedDifference(day)!) }}
            </td>
            <td class="border border-gray-400 px-1.5 py-0.5">{{ [day.sickLeave ? de.sickLeave.sheetReason : '', day.note].filter(Boolean).join(' · ') }}</td>
          </tr>
        </tbody>
      </table>

      <table class="mt-3 text-sm">
        <tbody>
          <tr><td class="pr-4">{{ de.time.totalTarget }}</td><td class="text-right font-medium">{{ formatDuration(totals.target) }}</td></tr>
          <tr><td class="pr-4">{{ de.time.totalCounted }}</td><td class="text-right font-medium">{{ formatDuration(totals.counted) }}</td></tr>
          <tr><td class="pr-4">{{ de.time.totalDelta }}</td><td class="text-right font-semibold">{{ formatSignedDuration(totals.delta) }}</td></tr>
        </tbody>
      </table>

      <div class="mt-12 grid grid-cols-2 gap-12 text-xs break-inside-avoid">
        <div class="border-t border-gray-500 pt-1">{{ de.time.signEmployee }}</div>
        <div class="border-t border-gray-500 pt-1">{{ de.time.signLead }}</div>
      </div>
      <p class="mt-4 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
    </template>
  </div>
</template>
