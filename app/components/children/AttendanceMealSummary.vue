<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { AttendanceDayDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { mealSummaryTable } from '~/utils/mealSummary'

/**
 * The meal box of the day list and its print: one tile per meal of the day ("Snack · 9:30", "12 Kinder"), then a
 * small table per group (Kinder da, per meal "n Kinder · m nicht") with the total. Counts only, no names.
 * Nothing on a day without meals. Headed „Essen heute“ on today's list, otherwise and in the print „Essen am …“.
 */
const props = defineProps<{ day: AttendanceDayDto; print?: boolean }>()
const s = de.attendance

const heading = computed(() => (!props.print && props.day.date === todayIso() ? s.mealsToday : s.mealsOn(formatDate(props.day.date))))

const tiles = computed(() => props.day.meals.map(meal => ({
  mealId: meal.mealId, head: s.mealTileHead(meal.name, formatTime(meal.time)), count: props.day.counts.meals[meal.mealId] ?? 0,
})))
const table = computed(() => mealSummaryTable(props.day))

const th = computed(() => (props.print ? 'border border-gray-400 px-1.5 py-1 font-semibold' : 'px-2 py-1 font-medium'))
const td = computed(() => (props.print ? 'border border-gray-400 px-1.5 py-1' : 'px-2 py-1'))
// The meal columns are set apart from each other (and from Kinder da) by a vertical line.
const mealSep = computed(() => (props.print ? 'border-l-2 border-l-black' : 'border-l border-gray-300'))
</script>

<template>
  <div v-if="day.meals.length" :class="print ? 'mb-4 space-y-1 break-inside-avoid' : 'space-y-2 rounded-lg bg-white p-3 ring-1 ring-gray-200'">
    <h2 :class="print ? 'text-base font-semibold' : 'text-sm font-semibold'">{{ heading }}</h2>
    <ul class="flex flex-wrap gap-2">
      <li
        v-for="tile in tiles"
        :key="tile.mealId"
        :class="print ? 'rounded border-2 border-black px-3 py-1.5 text-center break-inside-avoid' : 'rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-center'"
      >
        <div :class="print ? 'text-xs font-semibold' : 'text-xs font-medium text-gray-600'">{{ tile.head }}</div>
        <div :class="print ? 'text-lg font-bold tabular-nums' : 'text-xl font-semibold tabular-nums text-gray-900'">{{ s.mealChildren(tile.count) }}</div>
      </li>
    </ul>
    <div v-if="table.rows.length" class="overflow-x-auto">
      <table :class="print ? 'border-collapse text-xs' : 'text-sm'">
        <thead :class="print ? 'bg-gray-100' : 'text-xs text-gray-500'">
          <tr>
            <th scope="col" :class="th" class="text-left">{{ s.summary.group }}</th>
            <th scope="col" :class="th" class="text-right">{{ s.summary.here }}</th>
            <th v-for="meal in day.meals" :key="meal.mealId" scope="col" :class="[th, mealSep]" class="text-right">{{ meal.name }} {{ formatTime(meal.time) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in table.rows" :key="row.groupId ?? 'none'" :class="print ? '' : 'border-t border-gray-100'">
            <th scope="row" :class="td" class="text-left font-normal">{{ row.groupId === null ? s.summary.noGroup : row.name }}</th>
            <td :class="td" class="text-right tabular-nums">{{ row.here }}</td>
            <td v-for="cell in row.meals" :key="cell.mealId" :class="[td, mealSep]" class="whitespace-nowrap text-right tabular-nums">
              {{ s.mealChildren(cell.eating) }}<span :class="print ? '' : 'text-gray-500'"> · {{ s.notEating(cell.notEating) }}</span>
            </td>
          </tr>
          <tr class="font-semibold" :class="print ? '' : 'border-t border-gray-300'">
            <th scope="row" :class="td" class="text-left font-semibold">{{ s.summary.total }}</th>
            <td :class="td" class="text-right tabular-nums">{{ table.total.here }}</td>
            <td v-for="cell in table.total.meals" :key="cell.mealId" :class="[td, mealSep]" class="whitespace-nowrap text-right tabular-nums">
              {{ s.mealChildren(cell.eating) }}<span :class="print ? 'font-normal' : 'font-normal text-gray-500'"> · {{ s.notEating(cell.notEating) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
