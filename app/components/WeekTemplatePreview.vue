<script setup lang="ts">
import type { WeekTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Read-only table of a week template: employees × Monday–Friday. */
defineProps<{ template: WeekTemplateDto }>()
</script>

<template>
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
</template>
