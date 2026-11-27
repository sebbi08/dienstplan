<script setup lang="ts">
import { de } from '~/locales/de'
import { createInfoDraft } from '~/utils/infoDraft'

/**
 * An Info text of the plan to edit in place (at most 200 characters, wrapped). In the plan it shows at most two lines,
 * with „…“ when there is more (the whole text as its tooltip), so long texts do not make the rows tall; on click or focus
 * it opens to the whole text and grows with it while typing. Saved on leaving the field when it changed (`save`, which
 * tells whether it worked); Enter leaves it (and so saves), Shift+Enter is no line break either (Info texts are one
 * paragraph), Escape puts the saved text back.
 *
 * The field shows its own draft (infoDraft.ts), never the saved text while it is edited: a re-render (the two-line state,
 * the reload after saving) does not touch what is being typed, nor a word an input method is composing. The draft stays
 * until the save is through; when it fails, the typed text stays in the field, marked, to try again.
 */
const props = defineProps<{ value: string; label?: string; save: (value: string) => Promise<boolean> }>()

const area = useTemplateRef<HTMLTextAreaElement>('area')
const draft = createInfoDraft(() => props.value, text => props.save(text))
const { text, editing, failed } = draft
/** More than two lines: shown cut with „…“ while the field is not focused. */
const clamped = ref(false)

/** The height of two lines with the padding and the borders (border-box). */
function twoLines(element: HTMLTextAreaElement): number {
  const style = getComputedStyle(element)
  const line = Number.parseFloat(style.lineHeight) || 16
  const extra = element.offsetHeight - element.clientHeight
  return 2 * line + Number.parseFloat(style.paddingTop || '0') + Number.parseFloat(style.paddingBottom || '0') + extra
}

/** The whole text while focused, at most two lines otherwise. */
function grow() {
  const element = area.value
  if (!element) return
  element.style.height = 'auto'
  // border-box: the height holds the borders too, scrollHeight does not.
  const full = element.scrollHeight + element.offsetHeight - element.clientHeight
  const limit = twoLines(element)
  clamped.value = full > limit + 1
  element.style.height = `${editing.value ? full : Math.min(full, limit)}px`
  if (!editing.value) element.scrollTop = 0
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
  draft.savedChanged()
  await nextTick()
  grow()
})
// The draft may change without input (Escape, after saving): the height follows once the field shows it.
watch(text, async () => {
  await nextTick()
  grow()
})

/** Puts `value` into the field when the draft made it differ (line breaks became spaces). */
function show(element: HTMLTextAreaElement, value: string) {
  if (element.value !== value) element.value = value
}

function onInput(event: Event) {
  const element = event.target as HTMLTextAreaElement
  // While an input method composes a word, the field is left as it is (the draft takes it as typed).
  if ((event as InputEvent).isComposing) draft.compositionStart()
  show(element, draft.input(element.value))
  grow()
}

function onCompositionEnd(event: CompositionEvent) {
  const element = event.target as HTMLTextAreaElement
  show(element, draft.compositionEnd(element.value))
  grow()
}

function onFocus() {
  draft.focus()
  grow()
}

function onBlur() {
  void draft.blur()
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
    draft.reset()
    element.value = text.value
    grow()
    element.blur()
  }
}
</script>

<template>
  <div>
    <div class="relative">
      <textarea
        ref="area" :value="text" maxlength="200" rows="1" :aria-label="label" :aria-invalid="failed || undefined"
        :title="failed ? de.planCompact.infoSaveFailed : clamped && !editing ? `${text}\n${de.planCompact.infoEditHint}` : undefined"
        class="block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded border bg-transparent px-1 text-xs leading-snug focus:border-sky-500 focus:outline-none"
        :class="failed ? 'border-red-500' : 'border-transparent hover:border-gray-300'"
        @input="onInput" @compositionstart="draft.compositionStart()" @compositionend="onCompositionEnd"
        @keydown="onKeydown" @focus="onFocus" @blur="onBlur"
      />
      <!-- „…“: the text goes on (a click shows and edits all of it). -->
      <span
        v-if="clamped && !editing" aria-hidden="true"
        class="pointer-events-none absolute right-0.5 bottom-0.5 rounded-sm bg-white/90 px-0.5 text-xs leading-none text-gray-500"
      >…</span>
    </div>
    <p v-if="failed && !editing" class="px-1 text-[11px] leading-tight text-red-700" role="alert">{{ de.planCompact.infoSaveFailed }}</p>
  </div>
</template>
