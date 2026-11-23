<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'
import { FORM_LIMITS } from '#shared/domain/forms'
import { isRichText, richTextFromAnswer, sameTextAnswer, sanitizeRichText, textAnswerLength } from '#shared/domain/richText'
import { de } from '~/locales/de'

/**
 * The field of a free-text answer: a small editor (Nuxt UI's UEditor, TipTap) with a toolbar for Fett, Kursiv,
 * Unterstrichen, Aufzählung, nummerierte Liste, Rückgängig and Wiederholen; Strg+B/I/U, „- “ and „1. “ at the start of a
 * line start a list. The model is the sanitized HTML (shared/domain/richText.ts), so it equals what the server stores;
 * an old plain-text answer is shown as paragraphs and stays as it is until its content changes (then it is saved as
 * HTML). Pasted text keeps only what the editor knows (the formatting above); the toolbar wraps on small screens and
 * its buttons are 40 px.
 */
const props = defineProps<{ labelledby?: string }>()
const model = defineModel<string>({ required: true })
const r = de.forms.richText

/** What the editor holds (its own HTML); the model only gets the sanitized form of it. */
const content = ref(richTextFromAnswer(model.value))
/** The model value this field gave out last: any other value comes from outside (a reload) and replaces the content. */
let given = model.value
watch(model, (value) => {
  if (value === given) return
  given = value
  content.value = richTextFromAnswer(value)
})

function onUpdate(value: unknown) {
  const html = typeof value === 'string' ? value : ''
  content.value = html
  const clean = sanitizeRichText(html)
  // The same content as before (e.g. bold on and off again, or an old plain text unchanged) keeps the stored string.
  const next = sameTextAnswer(clean, model.value) ? model.value : clean
  given = next
  if (next !== model.value) model.value = next
}

const length = computed(() => textAnswerLength(model.value))
/** Too many characters, or (rarely, with very much formatting) too big as HTML: the server refuses both. */
const tooManyCharacters = computed(() => length.value > FORM_LIMITS.textAnswer)
const tooMuchFormatting = computed(() => isRichText(model.value) && model.value.length > FORM_LIMITS.textAnswerHtml)
const tooLong = computed(() => tooManyCharacters.value || tooMuchFormatting.value)
const showCount = computed(() => tooLong.value || length.value > FORM_LIMITS.textAnswer * 0.9)
const limitText = computed(() => (tooManyCharacters.value
  ? r.tooLong(FORM_LIMITS.textAnswer)
  : tooMuchFormatting.value ? r.tooMuchFormatting : r.count(length.value, FORM_LIMITS.textAnswer)))

/** Only what is kept on saving: no headings, quotes, code, links, strike-through, images. */
const starterKit = {
  heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, strike: false, link: false,
} as const
/** Typing shortcuts (input and paste rules) only of the allowed formatting (UEditor always adds code and a rule). */
const rules = ['bold', 'italic', 'underline', 'bulletList', 'orderedList', 'listItem']
const editorProps = {
  attributes: {
    role: 'textbox', 'aria-multiline': 'true', ...(props.labelledby ? { 'aria-labelledby': props.labelledby } : {}),
    // Free texts are prose: spell checking and capitals as in any text field (UEditor turns them off).
    autocorrect: 'on', autocapitalize: 'sentences', spellcheck: 'true',
  },
  /** Code and rules (which the editor would keep) go before pasting; the rest is left to the editor's own rules. */
  transformPastedHTML: (html: string) => html.replace(/<\/?(?:code|kbd|samp|tt)\b[^>]*>/gi, '').replace(/<hr\b[^>]*>/gi, ''),
  /** Strg+E (code, from UEditor's own Code extension) would show formatting that saving drops: it does nothing here. */
  handleKeyDown: (_view: unknown, event: KeyboardEvent) =>
    (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'e',
}

/** A toolbar button of 40 px with its name (and shortcut) as label for screen readers and as tooltip. */
const button = (item: EditorToolbarItem & { 'aria-label': string }): EditorToolbarItem =>
  ({ ...item, tooltip: { text: item['aria-label'] }, class: 'size-10 justify-center' })
const items: EditorToolbarItem[][] = [
  [
    button({ kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', 'aria-label': r.bold }),
    button({ kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', 'aria-label': r.italic }),
    button({ kind: 'mark', mark: 'underline', icon: 'i-lucide-underline', 'aria-label': r.underline }),
  ],
  [
    button({ kind: 'bulletList', icon: 'i-lucide-list', 'aria-label': r.bulletList }),
    button({ kind: 'orderedList', icon: 'i-lucide-list-ordered', 'aria-label': r.orderedList }),
  ],
  [
    button({ kind: 'undo', icon: 'i-lucide-undo-2', 'aria-label': r.undo }),
    button({ kind: 'redo', icon: 'i-lucide-redo-2', 'aria-label': r.redo }),
  ],
]
</script>

<template>
  <div class="space-y-1">
    <UEditor
      v-slot="{ editor }" :model-value="content" content-type="html" :starter-kit="starterKit" :image="false"
      :mention="false" :enable-input-rules="rules" :enable-paste-rules="rules" :editor-props="editorProps"
      :ui="{
        root: ['rounded-md bg-default ring ring-inset focus-within:ring-2', tooLong ? 'ring-error focus-within:ring-error' : 'ring-accented focus-within:ring-primary'],
        content: 'min-h-16',
        base: 'min-h-16 px-3 py-2 text-sm sm:px-3 *:my-0 *:first:mt-0 *:last:mb-0 [&_p]:leading-6 [&_li]:my-0.5 [&_li]:ps-1',
      }"
      @update:model-value="onUpdate"
    >
      <UEditorToolbar
        :editor="editor" :items="items" size="md" role="toolbar" :aria-label="r.toolbar"
        :ui="{ base: 'flex-wrap gap-y-0.5 border-b border-default px-1 py-0.5' }"
      />
    </UEditor>
    <p v-if="showCount" class="text-xs" :class="tooLong ? 'text-error' : 'text-muted'" aria-live="polite">
      {{ limitText }}
    </p>
  </div>
</template>
