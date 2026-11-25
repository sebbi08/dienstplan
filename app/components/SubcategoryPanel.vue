<script setup lang="ts">
import { ALL_CHIP, GENERAL_CHIP, type SubChip } from '~/utils/subcategories'

/**
 * The subcategories of the chosen category on „Dokumente“ → „Zum Ausdrucken“ and „Wissen“: a tinted panel right below the
 * category chips (left border in the colour of the chosen chip), headed „Unterkategorien von ‹Kategorie›:“, with small
 * tabs „Alle (5)“, „Allgemein (1)“ and one per subcategory with its count. On a narrow screen (< 640 px) the tabs scroll
 * sideways inside the panel (the page does not), snapping to a tab, with a fade at the edge where more follow; wider
 * they wrap. Arrow keys, Home and End move between them as in a tab list. 40 px high for a finger.
 */
const props = defineProps<{
  chips: SubChip[]
  /** The ids of the small tabs start with this (unique on the page). */
  idPrefix: string
  /** The panel the small tabs control. */
  controls: string
  /** „Unterkategorien von Gesetze:“ – shown, and names the tab list. */
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
  nextTick(() => document.getElementById(`${props.idPrefix}-${keys[next]}`)?.focus({ preventScroll: true }))
}

// ---- sideways scrolling on a narrow screen -----------------------------------
const scroller = ref<HTMLElement | null>(null)
const moreLeft = ref(false)
const moreRight = ref(false)
/** Where more tabs lie outside the visible part (a fade shows there). */
function measure() {
  const element = scroller.value
  if (!element) return
  moreLeft.value = element.scrollLeft > 1
  moreRight.value = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
}
/** Brings the chosen tab into view inside the row (without moving the page up or down). */
function revealSelected() {
  const element = scroller.value
  const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]')
  if (!element || !tab) return
  const start = tab.offsetLeft - element.offsetLeft
  if (start < element.scrollLeft) element.scrollLeft = start - 16
  else if (start + tab.offsetWidth > element.scrollLeft + element.clientWidth) element.scrollLeft = start + tab.offsetWidth - element.clientWidth + 16
  measure()
}
let observer: ResizeObserver | null = null
onMounted(() => {
  revealSelected()
  measure()
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    observer = new ResizeObserver(measure)
    observer.observe(scroller.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch(selected, () => nextTick(revealSelected))
watch(() => props.chips, () => nextTick(measure))
</script>

<template>
  <div class="rounded-lg border-l-4 border-sky-500 bg-sky-50 py-2 pr-1 pl-3 ring-1 ring-sky-100 sm:pr-3">
    <p :id="`${idPrefix}-label`" class="mb-0.5 text-sm font-medium text-sky-900">{{ label }}</p>
    <div class="relative">
      <div
        ref="scroller" role="tablist" :aria-labelledby="`${idPrefix}-label`"
        class="flex snap-x snap-mandatory scroll-px-4 gap-1 overflow-x-auto py-1 [scrollbar-width:none] sm:snap-none sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
        @scroll.passive="measure"
      >
        <button
          v-for="chip in chips" :id="`${idPrefix}-${chip.key}`" :key="chip.key" type="button" role="tab"
          :aria-selected="selected === chip.key" :tabindex="selected === chip.key ? 0 : -1" :aria-controls="controls"
          class="inline-flex min-h-10 shrink-0 snap-start items-center gap-1 rounded-md border-b-2 px-3 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          :class="selected === chip.key
            ? 'border-sky-600 bg-white font-semibold text-sky-900 shadow-sm ring-1 ring-sky-200'
            : 'border-transparent text-sky-900 hover:bg-white/70'"
          @click="selected = chip.key" @keydown="onKey"
        >
          {{ chipLabel(chip) }} <span class="tabular-nums" :class="selected === chip.key ? 'text-sky-700' : 'text-sky-700/80'">({{ chip.count }})</span>
        </button>
      </div>
      <!-- More tabs to the side (narrow screens only): a fade at that edge. -->
      <div v-show="moreLeft" class="pointer-events-none absolute inset-y-0 left-0 w-6 bg-linear-to-r from-sky-50 to-transparent sm:hidden" aria-hidden="true" />
      <div v-show="moreRight" class="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-sky-50 to-transparent sm:hidden" aria-hidden="true" />
    </div>
  </div>
</template>
