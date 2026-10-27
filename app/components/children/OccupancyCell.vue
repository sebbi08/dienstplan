<script setup lang="ts">
import type { OccupancyCellDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { occupancyCellText } from '~/utils/occupancy'

/**
 * One cell of the occupancy table, on screen (a button that selects the cell) and in print (`print`: plain block).
 * Red is never colour only: bold text, an icon, a frame and the text "+n über Plätze".
 */
const props = defineProps<{ cell: OccupancyCellDto; label?: string; selected?: boolean; print?: boolean }>()
defineEmits<{ select: [] }>()

const classes = computed(() => [
  props.print ? 'block w-full px-1 py-1 text-center' : 'block w-full rounded px-1 py-1 text-center hover:ring-2 hover:ring-sky-300',
  props.cell.red
    ? ['bg-red-100 font-bold text-red-800 [print-color-adjust:exact]', props.print ? 'border-2 border-red-600' : 'ring-1 ring-inset ring-red-400']
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
  </component>
</template>
