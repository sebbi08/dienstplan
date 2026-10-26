<script setup lang="ts">
import { de } from '~/locales/de'
import { monthTitle, shiftMonth } from '~/utils/format'

/** `min`/`max`: the first and last month to go to (e.g. a cash book's start month and the running month). */
const props = defineProps<{ year: number; month: number; min?: { year: number; month: number }; max?: { year: number; month: number } }>()
const emit = defineEmits<{ change: [year: number, month: number] }>()

const index = (value: { year: number; month: number }) => value.year * 12 + value.month
const atMin = computed(() => props.min !== undefined && index(props) <= index(props.min))
const atMax = computed(() => props.max !== undefined && index(props) >= index(props.max))

function go(delta: number) {
  const next = shiftMonth(props.year, props.month, delta)
  emit('change', next.year, next.month)
}
</script>

<template>
  <div class="flex items-center gap-1">
    <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" class="print:hidden" :disabled="atMin" :aria-label="de.common.previousMonth" @click="go(-1)" />
    <h1 class="min-w-48 text-center text-2xl font-semibold">{{ monthTitle(year, month) }}</h1>
    <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" class="print:hidden" :disabled="atMax" :aria-label="de.common.nextMonth" @click="go(1)" />
  </div>
</template>
