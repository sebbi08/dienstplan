<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { AttendanceMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MONTH_CELL_SYMBOL } from '~/utils/attendance'
import { errorMessage } from '~/utils/errors'
import { formatDate, monthTitle } from '~/utils/format'

/** The month table of the child attendance for printing (Leitung and Träger): A4 landscape, one table per group. */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 8mm; }' }] })

const route = useRoute()
const year = Number(route.params.year)
const month = Number(route.params.month)
const { data, error } = await useFetch<AttendanceMonthDto>('/api/attendance/month', {
  query: { year, month }, key: `print-children-attendance-month-${year}-${month}`,
})

const s = de.attendance
const kinds = ['present', 'sick', 'vacation', 'excused', 'unexcused'] as const
const title = monthTitle(year, month)

const th = 'border border-gray-400 px-0.5 py-0.5 text-center font-semibold'
const td = 'border border-gray-400 px-0.5 py-0.5 text-center'
/** Grey for weekends, holidays and closure days; hatched for days on which the child was not in this group. */
const hatched = 'background-image: repeating-linear-gradient(45deg, #d1d5db 0 1px, transparent 1px 4px)'
</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-2 flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">{{ s.printMonthTitle(title) }}</h1>
      <p class="text-xs text-gray-600">{{ s.monthLegend }}</p>
      <PrintActions :file-name="`Anwesenheit-Kinder-${year}-${String(month).padStart(2, '0')}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p v-if="!data.groups.length" class="text-sm text-gray-600">{{ s.noChildren }}</p>
      <section
        v-for="(group, index) in data.groups" :key="group.id ?? 'none'"
        :class="index < data.groups.length - 1 ? 'break-after-page' : ''" class="mb-6"
      >
        <h2 class="mb-1 text-lg font-semibold">{{ group.id === null ? s.noGroup : group.name }}</h2>
        <table class="w-full border-collapse text-[10px]">
          <thead class="bg-gray-100">
            <tr>
              <th :class="th" class="text-left">{{ de.attendance.printColumns.child }}</th>
              <th v-for="day in data.days" :key="day.date" :class="[th, day.grey ? 'bg-gray-300' : '']">{{ Number(day.date.slice(8)) }}</th>
              <th v-for="kind in kinds" :key="kind" :class="th">{{ s.monthSums[kind] }}</th>
              <th :class="th" class="text-left">{{ s.remark }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="child in group.children" :key="child.childId" class="break-inside-avoid">
              <th scope="row" :class="td" class="whitespace-nowrap text-left font-medium">{{ child.name }}</th>
              <td
                v-for="day in data.days" :key="day.date" :class="[td, day.grey ? 'bg-gray-300' : '']"
                :style="child.cells[day.date] === undefined ? hatched : undefined"
              >
                {{ child.cells[day.date] ? MONTH_CELL_SYMBOL[child.cells[day.date]!] : '' }}
              </td>
              <td v-for="kind in kinds" :key="kind" :class="td" class="font-semibold">{{ child.sums[kind] || '' }}</td>
              <td :class="td" class="min-w-24 whitespace-pre-line break-words text-left">{{ child.remark }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
