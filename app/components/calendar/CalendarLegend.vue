<script setup lang="ts">
import { de } from '~/locales/de'

const ITEMS = [
  { class: 'bg-red-500', label: de.calendar.kinds.sick },
  { class: 'bg-green-500', label: de.calendar.kinds.vacation },
  { class: 'bg-lime-300', label: de.calendar.kinds.special_leave },
  { class: 'bg-sky-500', label: de.calendar.kinds.training },
  { class: 'bg-gray-400', label: de.calendar.kinds.closed },
  { class: 'bg-gray-100 ring-1 ring-gray-300', label: de.calendar.weekend },
  { class: 'bg-yellow-300', label: de.calendar.events },
]
</script>

<template>
  <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs" style="print-color-adjust: exact; -webkit-print-color-adjust: exact">
    <span v-for="item in ITEMS" :key="item.label" class="inline-flex items-center gap-1">
      <span class="inline-block h-3 w-3 rounded-sm" :class="item.class" /> {{ item.label }}
    </span>
  </div>
</template>
