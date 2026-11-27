<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * An Info text of the plan to edit in place (at most 200 characters, wrapped). In the plan it shows at most two lines,
 * with „…“ when there is more (the whole text as its tooltip), so long texts do not make the rows tall; on click or focus
 * it opens to the whole text and grows with it while typing. Saved on leaving the field when it changed (`save`); Enter
 * leaves it (and so saves), Shift+Enter is no line break either (Info texts are one paragraph), Escape puts the saved
 * text back.
 */
const props = defineProps<{ value: string; label?: string }>()
const emit = defineEmits<{ save: [value: string] }>()

const area = useTemplateRef<HTMLTextAreaElement>('area')
const focused = ref(false)
/** More than two lines: shown cut with „…“ while the field is not focused. */
const clamped = ref(false)

/** The height of two lines with the padding and the borders (border-box). */
function twoLines(element: HTMLTextAreaElement): number {
  const style = getComputedStyle(element)
  const line = Number.parseFloat(style.lineHeight) || 16
  const extra = element.offsetHeight - element.clientHeight
  return 2 * line + Number.parseFloat(style.paddingTop || '0') + Number.parseFloat(style.paddingBottom || '0') + extra
}

function grow() {
  const element = area.value
  if (!element) return
  element.style.height = 'auto'
  // border-box: the height holds the borders too, scrollHeight does not.
  const full = element.scrollHeight + element.offsetHeight - element.clientHeight
  const limit = twoLines(element)
  clamped.value = full > limit + 1
  element.style.height = `${focused.value ? full : Math.min(full, limit)}px`
  if (!focused.value) element.scrollTop = 0
}

// The column can get wider or narrower (window, other texts): the height follows its width.
let observer: ResizeObserver | null = null
let lastWidth = 0
onMounted(() => {
  grow()
  if (typeof ResizeObserver === 'undefined' || !area.value) return
  observer = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? 0
    if (width === lastWidth) return
    lastWidth = width
    grow()
  })
  observer.observe(area.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.value, async () => {
  if (area.value && area.value.value !== props.value) area.value.value = props.value
  await nextTick()
  grow()
})

/** One paragraph: line breaks (pasted ones too) become spaces. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ')

function onInput(event: Event) {
  const element = event.target as HTMLTextAreaElement
  const flat = oneLine(element.value)
  if (flat !== element.value) element.value = flat
  grow()
}

function onChange(event: Event) {
  const text = oneLine((event.target as HTMLTextAreaElement).value)
  if (text !== props.value) emit('save', text)
}

function onFocus() {
  focused.value = true
  grow()
}

function onBlur() {
  focused.value = false
  grow()
}

function onKeydown(event: KeyboardEvent) {
  // While an input method composes a word (e.g. accents, Asian scripts), Enter belongs to it.
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    ;(event.target as HTMLTextAreaElement).blur()
  }
  else if (event.key === 'Escape') {
    const element = event.target as HTMLTextAreaElement
    element.value = props.value
    grow()
    element.blur()
  }
}
</script>

<template>
  <div class="relative">
    <textarea
      ref="area" :value="value" maxlength="200" rows="1" :aria-label="label"
      :title="clamped && !focused ? `${value}\n${de.planCompact.infoEditHint}` : undefined"
      class="block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded border border-transparent bg-transparent px-1 text-xs leading-snug hover:border-gray-300 focus:border-sky-500 focus:outline-none"
      @input="onInput" @change="onChange" @keydown="onKeydown" @focus="onFocus" @blur="onBlur"
    />
    <!-- „…“: the text goes on (a click shows and edits all of it). -->
    <span
      v-if="clamped && !focused" aria-hidden="true"
      class="pointer-events-none absolute right-0.5 bottom-0.5 rounded-sm bg-white/90 px-0.5 text-xs leading-none text-gray-500"
    >…</span>
  </div>
</template>
