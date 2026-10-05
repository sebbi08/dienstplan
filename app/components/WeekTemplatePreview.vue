<script setup lang="ts">
import { formatDuration, formatTime, netMinutes } from '#shared/domain/time'
import type { WeekTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Read-only table of a week template (employees × Monday–Friday) with a legend of the short labels used. */
defineProps<{ template: WeekTemplateDto }>()

type LegendItem = WeekTemplateDto['legend'][number]
const span = (item: LegendItem) => `${formatTime(item.start)}–${formatTime(item.end)}`
const pause = (item: LegendItem) => (item.breakStart !== null && item.breakEnd !== null
  ? de.weekTemplates.legendBreak(formatTime(item.breakStart), formatTime(item.breakEnd))
  : de.weekTemplates.legendNoBreak)
</script>

<template>
  <div class="space-y-2">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-xs">
        <thead class="bg-gray-100 text-left text-gray-600">
          <tr>
            <th class="border border-gray-200 px-2 py-1">{{ de.weekTemplates.employee }}</th>
            <th v-for="day in de.weekdaysShort.slice(0, 5)" :key="day" class="border border-gray-200 px-2 py-1">{{ day }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in template.rows" :key="row.employeeId">
            <td class="whitespace-nowrap border border-gray-200 px-2 py-1 font-medium">{{ row.name }}</td>
            <td v-for="(text, index) in row.days" :key="index" class="border border-gray-200 px-2 py-1">{{ text || '–' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <dl v-if="template.legend.length" class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
      <div v-for="item in template.legend" :key="item.shortLabel" class="flex gap-1">
        <dt class="font-semibold text-gray-900">{{ item.shortLabel }}</dt>
        <dd>
          {{ item.label }}: {{ span(item) }}, {{ pause(item) }},
          {{ de.weekTemplates.legendWorked(formatDuration(netMinutes(item))) }}
        </dd>
      </div>
    </dl>
  </div>
</template>
