<script setup lang="ts">
import { cellFillColor } from '#shared/domain/cells'
import type { MyPlanDayDto, MyPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cellFillClasses } from '~/utils/colors'
import { errorMessage } from '~/utils/errors'
import { formatDateTime, formatDayShort } from '~/utils/format'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { data, error } = await useFetch<MyPlanDto>(() => `/api/my/plan/${year.value}/${month.value}`)

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/my/plan/${nextYear}/${nextMonth}`)
}

function changeTitle(day: MyPlanDayDto): string | undefined {
  return day.changes
    .map(change => de.plan.changedTooltip(change.before || de.plan.empty, change.after || de.plan.empty, formatDateTime(change.changedAt), change.changedBy))
    .join('\n') || undefined
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
      <UBadge v-if="data?.release.changeCount" color="warning" variant="soft" :label="de.plan.changesSinceRelease(data.release.changeCount)" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <table v-if="data" class="w-full overflow-hidden rounded-lg text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.plan.date }}</th>
          <th class="px-3 py-2">{{ de.myPlan.shift }}</th>
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
          <td class="px-3 py-1.5 text-xs">{{ day.info1 }}</td>
          <td class="px-3 py-1.5 text-xs">{{ day.info2 }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
