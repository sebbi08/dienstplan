<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { AttendanceDayDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { mealSummaryTable } from '~/utils/mealSummary'

/**
 * The box "Essen heute" of the day list and its print: per meal of the day the children counted ("Snack 9:30: 12"),
 * then a small table per group (Kinder da, per meal the number eating · not eating) with the total. Counts only, no
 * names. Nothing on a day without meals.
 */
const props = defineProps<{ day: AttendanceDayDto; print?: boolean }>()
const s = de.attendance

const mealsLine = computed(() => s.meals(props.day.meals.map(meal => ({
  name: meal.name, time: formatTime(meal.time), count: props.day.counts.meals[meal.mealId] ?? 0,
}))))
const table = computed(() => mealSummaryTable(props.day))

const th = computed(() => (props.print ? 'border border-gray-400 px-1.5 py-1 font-semibold' : 'px-2 py-1 font-medium'))
const td = computed(() => (props.print ? 'border border-gray-400 px-1.5 py-1' : 'px-2 py-1'))
</script>

<template>
  <div v-if="day.meals.length" :class="print ? 'mb-4 space-y-1 break-inside-avoid' : 'space-y-2 rounded-lg bg-white p-3 ring-1 ring-gray-200'">
    <h2 :class="print ? 'text-base font-semibold' : 'text-sm font-semibold'">{{ s.mealsToday }}</h2>
    <p :class="print ? 'text-sm' : 'text-base font-medium'">{{ mealsLine }}</p>
    <div v-if="table.rows.length" class="overflow-x-auto">
      <table :class="print ? 'border-collapse text-xs' : 'text-sm'">
        <thead :class="print ? 'bg-gray-100' : 'text-xs text-gray-500'">
          <tr>
            <th :class="th" class="text-left">{{ s.summary.group }}</th>
            <th :class="th" class="text-right">{{ s.summary.here }}</th>
            <th v-for="meal in day.meals" :key="meal.mealId" :class="th" class="text-right">{{ meal.name }} {{ formatTime(meal.time) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in table.rows" :key="row.groupId ?? 'none'" :class="print ? '' : 'border-t border-gray-100'">
            <td :class="td">{{ row.groupId === null ? s.summary.noGroup : row.name }}</td>
            <td :class="td" class="text-right tabular-nums">{{ row.here }}</td>
            <td v-for="cell in row.meals" :key="cell.mealId" :class="td" class="whitespace-nowrap text-right tabular-nums">
              {{ cell.eating }}<span :class="print ? '' : 'text-gray-500'"> · {{ s.notEating(cell.notEating) }}</span>
            </td>
          </tr>
          <tr class="font-semibold" :class="print ? '' : 'border-t border-gray-300'">
            <td :class="td">{{ s.summary.total }}</td>
            <td :class="td" class="text-right tabular-nums">{{ table.total.here }}</td>
            <td v-for="cell in table.total.meals" :key="cell.mealId" :class="td" class="whitespace-nowrap text-right tabular-nums">
              {{ cell.eating }}<span :class="print ? 'font-normal' : 'font-normal text-gray-500'"> · {{ s.notEating(cell.notEating) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
