<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * An Info text of the plan, read-only (plan without editing rights, the tablet's plan): at most two lines with „…“; a
 * longer text is a button that opens the whole text (and closes it again). The printout always shows the whole text.
 * No display class (`block`) next to `line-clamp-2`: it would replace the clamp's own display and show every line.
 */
const props = defineProps<{ text: string }>()
const box = useTemplateRef<HTMLElement>('box')
const open = ref(false)
const clamped = ref(false)

function measure() {
  const element = box.value
  if (!element || open.value) return
  clamped.value = element.scrollHeight > element.clientHeight + 1
}

// The column can get wider or narrower (window, other texts): measured again. The text's element changes once it is a
// button, so the observer follows it.
let observer: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(() => measure())
  if (box.value) observer?.observe(box.value)
})
watch(box, (element, before) => {
  if (before) observer?.unobserve(before)
  if (element) observer?.observe(element)
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.text, async () => {
  open.value = false
  await nextTick()
  measure()
})
</script>

<template>
  <button
    v-if="clamped" type="button"
    class="block w-full rounded text-left text-xs break-words whitespace-normal hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-sky-500"
    :aria-expanded="open" :title="open ? de.planCompact.infoCollapse : `${text}\n${de.planCompact.infoExpand}`" @click.stop="open = !open"
  >
    <span ref="box" :class="open ? 'block' : 'line-clamp-2 print:line-clamp-none'">{{ text }}</span>
  </button>
  <span v-else ref="box" class="text-xs break-words whitespace-normal line-clamp-2 print:line-clamp-none">{{ text }}</span>
</template>
