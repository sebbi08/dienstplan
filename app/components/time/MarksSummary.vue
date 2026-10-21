<script setup lang="ts">
import type { TimeMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * The month's late arrivals (red) and, when the facility marks them, early leaving (blue); Leitung and Träger only.
 * `print`: the printed sheet names only the tolerance, not where it is set.
 */
defineProps<{ marks: TimeMonthDto['marks']; print?: boolean }>()
</script>

<template>
  <div class="space-y-0.5 text-sm">
    <div class="font-semibold">{{ de.time.marksTitle }}</div>
    <div :class="marks.lateCount ? 'text-red-600' : 'text-gray-600'">{{ de.time.lateSummary(marks.lateCount, marks.lateMinutes) }}</div>
    <div v-if="marks.markEarlyLeave" :class="marks.earlyCount ? 'text-blue-600' : 'text-gray-600'">
      {{ de.time.earlySummary(marks.earlyCount, marks.earlyMinutes) }}
    </div>
    <div class="text-xs text-gray-500">{{ print ? de.time.marksTolerance(marks.toleranceMinutes) : de.time.marksHint(marks.toleranceMinutes) }}</div>
  </div>
</template>
