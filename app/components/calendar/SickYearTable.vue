<script setup lang="ts">
import type { SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** Sick periods per employee of one year; shared by the page and its print view. */
defineProps<{ rows: SickYearRowDto[] }>()

const period = (range: { from: string; to: string; days: number }) =>
  `${range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`} · ${de.sickDays.days(range.days)}`
</script>

<template>
  <table class="w-full border-collapse text-sm">
    <thead class="text-left text-xs text-gray-600">
      <tr>
        <th class="border border-gray-300 px-2 py-1">{{ de.sickDays.name }}</th>
        <th class="border border-gray-300 px-2 py-1">{{ de.sickDays.periods }}</th>
        <th class="border border-gray-300 px-2 py-1 text-right">{{ de.sickDays.total }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.employeeId" class="break-inside-avoid align-top">
        <td class="whitespace-nowrap border border-gray-300 px-2 py-1 font-medium">{{ row.name }}</td>
        <td class="border border-gray-300 px-2 py-1">
          <span v-if="!row.ranges.length" class="text-gray-500">{{ de.sickDays.none }}</span>
          <div v-for="range in row.ranges" :key="range.from">{{ period(range) }}</div>
        </td>
        <td class="border border-gray-300 px-2 py-1 text-right font-semibold">{{ row.total }}</td>
      </tr>
    </tbody>
  </table>
</template>
