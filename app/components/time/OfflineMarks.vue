<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * The marks of a record from the tablet's offline queue: „offline erfasst“, and for Leitung/Träger „Uhrzeit des Tablets
 * wich ab (‹Minuten› Min.)“ when the tablet's clock was more than 5 minutes off (the employee's own page never gets the
 * difference from the server).
 */
defineProps<{ record: { offline: boolean; clockSkewMinutes: number | null } }>()
</script>

<template>
  <span v-if="record.offline" class="inline-flex flex-wrap items-center gap-1 text-xs">
    <span class="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1 text-sky-800 ring-1 ring-sky-200">
      <UIcon name="i-lucide-wifi-off" class="shrink-0" />{{ de.time.offlineRecorded }}
    </span>
    <span
      v-if="record.clockSkewMinutes !== null" class="rounded bg-orange-50 px-1 text-orange-800 ring-1 ring-orange-200"
      :title="de.time.clockSkewTitle(record.clockSkewMinutes)"
    >{{ de.time.clockSkew(record.clockSkewMinutes) }}</span>
  </span>
</template>
