<script setup lang="ts">
import { ALL_CHIP, GENERAL_CHIP, type SubChip } from '~/utils/subcategories'

/**
 * The second row of small tabs on a category's sub-tab of „Dokumente“ → „Vorlagen“ and „Wissen“: „Alle“, „Allgemein“
 * and the subcategories. They wrap on a narrow screen (no sideways scrolling of the page); arrow keys, Home and End move
 * between them as in a tab list. 40 px high for a finger.
 */
const props = defineProps<{
  chips: SubChip[]
  /** The ids of the small tabs start with this (unique on the page). */
  idPrefix: string
  /** The panel the small tabs control. */
  controls: string
  label: string
  allLabel: string
  generalLabel: string
}>()
const selected = defineModel<string | null>({ required: true })

const chipLabel = (chip: SubChip) =>
  (chip.key === ALL_CHIP ? props.allLabel : chip.key === GENERAL_CHIP ? props.generalLabel : chip.subcategory?.name ?? '')

function onKey(event: KeyboardEvent) {
  const keys = props.chips.map(chip => chip.key)
  const index = keys.indexOf(selected.value ?? '')
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  selected.value = keys[next]
  nextTick(() => document.getElementById(`${props.idPrefix}-${keys[next]}`)?.focus())
}
</script>

<template>
  <div role="tablist" :aria-label="label" class="flex flex-wrap gap-1.5">
    <button
      v-for="chip in chips" :id="`${idPrefix}-${chip.key}`" :key="chip.key" type="button" role="tab"
      :aria-selected="selected === chip.key" :tabindex="selected === chip.key ? 0 : -1" :aria-controls="controls"
      class="min-h-10 rounded-full px-3 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="selected === chip.key ? 'bg-gray-800 font-semibold text-white ring-gray-800' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
      @click="selected = chip.key" @keydown="onKey"
    >
      {{ chipLabel(chip) }}
    </button>
  </div>
</template>
