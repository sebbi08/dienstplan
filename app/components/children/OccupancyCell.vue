<script setup lang="ts">
import type { OccupancyCellDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { occupancyCellText } from '~/utils/occupancy'

/**
 * One cell of the occupancy table, on screen (a button that selects the cell) and in print (`print`: plain block).
 * Red is never colour only: bold text, an icon, a frame and the text "+n über Plätze". An exceeded age limit of the
 * group likewise: an icon and the text „Altersgrenze überschritten“ (which rule: the cell's child list).
 */
const props = defineProps<{ cell: OccupancyCellDto; label?: string; selected?: boolean; print?: boolean }>()
defineEmits<{ select: [] }>()

const ageExceeded = computed(() => props.cell.ageViolations.length > 0)
const classes = computed(() => [
  props.print ? 'block w-full px-1 py-1 text-center' : 'block w-full rounded px-1 py-1 text-center hover:ring-2 hover:ring-sky-300',
  props.cell.red
    ? ['bg-red-100 font-bold text-red-800 [print-color-adjust:exact]', props.print ? 'border-2 border-red-600' : 'ring-1 ring-inset ring-red-400']
    : ageExceeded.value
      ? ['bg-amber-50 text-amber-900 [print-color-adjust:exact]', props.print ? 'border-2 border-amber-500' : 'ring-1 ring-inset ring-amber-400']
      : '',
  props.selected ? 'ring-2 ring-sky-600' : '',
])
</script>

<template>
  <component
    :is="print ? 'div' : 'button'" :type="print ? undefined : 'button'" :class="classes"
    :aria-label="print ? undefined : label" :aria-pressed="print ? undefined : !!selected" @click="$emit('select')"
  >
    <span class="whitespace-nowrap"><UIcon v-if="cell.red" name="i-lucide-triangle-alert" class="mr-0.5 size-3.5 align-text-bottom" aria-hidden="true" />{{ occupancyCellText(cell) }}</span>
    <span v-if="cell.over > 0" class="block text-[10px] font-semibold leading-tight">{{ de.occupancy.over(cell.over) }}</span>
    <span v-if="ageExceeded" class="block text-[10px] font-semibold leading-tight text-amber-800">
      <UIcon name="i-lucide-baby" class="mr-0.5 size-3 align-text-bottom" aria-hidden="true" />{{ de.ageLimits.exceeded }}
    </span>
  </component>
</template>
