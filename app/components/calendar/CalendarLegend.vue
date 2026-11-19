<script setup lang="ts">
import { de } from '~/locales/de'
import { REQUEST_CLASSES } from '~/utils/calendarRequests'

/** `planning`: the leave planning calendar (open wishes and a count row instead of appointments). */
/** `requests`: the year calendar shows open requests („beantragt“) and the days above the limit. */
const props = defineProps<{ planning?: boolean; requests?: boolean }>()

const COMMON = [
  { class: 'bg-red-500', label: de.calendar.kinds.sick },
  { class: 'bg-green-500', label: de.calendar.kinds.vacation },
  { class: 'bg-teal-500', label: de.calendar.kinds.overtime_off },
  { class: 'bg-lime-300', label: de.calendar.kinds.special_leave },
  { class: 'bg-sky-500', label: de.calendar.kinds.training },
  { class: 'bg-pink-400', label: de.calendar.kinds.maternity },
  { class: 'bg-stone-400', label: de.calendar.kinds.absent },
  { class: 'bg-gray-400', label: de.calendar.kinds.closed },
  { class: 'bg-gray-100 ring-1 ring-gray-300', label: de.calendar.weekend },
]
const items = computed(() => props.planning
  ? [
      COMMON[1]!,
      { class: 'bg-[repeating-linear-gradient(45deg,var(--color-green-200)_0_3px,var(--color-green-400)_3px_6px)]', label: de.calendar.kinds.requested },
      ...COMMON.filter((_, index) => index !== 1),
      { class: 'bg-purple-600', label: de.leavePlanning.overLimitLegend },
    ]
  : [
      ...COMMON,
      ...(props.requests
        ? [
            { class: REQUEST_CLASSES.vacation, label: de.calendar.requested },
            { class: REQUEST_CLASSES.overtime_off, label: de.calendar.requestedOvertimeOff },
            { class: 'bg-purple-600', label: de.calendar.overLimitLegend },
          ]
        : []),
      { class: 'bg-yellow-300', label: de.calendar.events },
    ])
</script>

<template>
  <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs" style="print-color-adjust: exact; -webkit-print-color-adjust: exact">
    <span v-for="item in items" :key="item.label" class="inline-flex items-center gap-1">
      <span class="inline-block h-3 w-3 rounded-sm" :class="item.class" /> {{ item.label }}
    </span>
  </div>
</template>
