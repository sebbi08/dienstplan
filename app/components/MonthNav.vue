<script setup lang="ts">
import { de } from '~/locales/de'
import { monthTitle, shiftMonth } from '~/utils/format'

const props = defineProps<{ year: number; month: number }>()
const emit = defineEmits<{ change: [year: number, month: number] }>()

function go(delta: number) {
  const next = shiftMonth(props.year, props.month, delta)
  emit('change', next.year, next.month)
}
</script>

<template>
  <div class="flex items-center gap-1">
    <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" class="print:hidden" :aria-label="de.common.previousMonth" @click="go(-1)" />
    <h1 class="min-w-48 text-center text-2xl font-semibold">{{ monthTitle(year, month) }}</h1>
    <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" class="print:hidden" :aria-label="de.common.nextMonth" @click="go(1)" />
  </div>
</template>
