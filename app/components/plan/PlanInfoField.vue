<script setup lang="ts">
/**
 * An Info text of the plan to edit in place: wraps and grows with its text (at most 200 characters), so the whole text
 * stays readable. Saved on leaving the field when it changed (`save`); Enter leaves it (and so saves), Shift+Enter is
 * no line break either (Info texts are one paragraph), Escape puts the saved text back.
 */
const props = defineProps<{ value: string; label?: string }>()
const emit = defineEmits<{ save: [value: string] }>()

const area = useTemplateRef<HTMLTextAreaElement>('area')

function grow() {
  const element = area.value
  if (!element) return
  element.style.height = 'auto'
  // border-box: the height holds the borders too, scrollHeight does not.
  element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`
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
  <textarea
    ref="area" :value="value" maxlength="200" rows="1" :aria-label="label"
    class="block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded border border-transparent bg-transparent px-1 text-xs leading-snug hover:border-gray-300 focus:border-sky-500 focus:outline-none"
    @input="onInput" @change="onChange" @keydown="onKeydown"
  />
</template>
