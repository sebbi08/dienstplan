<script setup lang="ts">
import { formatTime } from '#shared/domain/time'

/**
 * One stamped period "7:55–16:00" of the Leitung's time sheet: the arrival red when it is the day's late first arrival,
 * the departure blue when it is the day's early last departure.
 */
defineProps<{ record: { start: number; end: number | null }; late?: boolean; early?: boolean }>()
</script>

<template>
  <span><span :class="late ? 'font-semibold text-red-600' : ''">{{ formatTime(record.start) }}</span>–<span :class="early ? 'font-semibold text-blue-600' : ''">{{ record.end === null ? '…' : formatTime(record.end) }}</span></span>
</template>
