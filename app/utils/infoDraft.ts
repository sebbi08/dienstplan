import { ref } from 'vue'

/** One paragraph: line breaks (pasted ones too) become spaces. */
export const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ')

/**
 * What an Info field of the plan (PlanInfoField) shows while it is edited: its own draft, not the saved text. A re-render
 * of the field (its two-line state, focus, a reload of the plan) never puts the saved text back over what is being typed.
 *
 * - `text` is what the field shows; `input` takes what was typed (line breaks become spaces, not while an input method
 *   composes a word) and returns the text the field should hold.
 * - `blur` saves when the text differs from the saved one (the server trims, so spaces at the ends are no change). The
 *   draft stays visible until the save is through; when it fails, the typed text stays in the field (`failed`), ready to
 *   try again.
 * - `reset` (Escape) puts the saved text back.
 * - `savedChanged` (the saved text changed, e.g. after a reload): taken over only while the field is not being edited or
 *   saved and holds no failed text.
 */
export function createInfoDraft(saved: () => string, save: (text: string) => Promise<boolean>) {
  const text = ref(saved())
  const editing = ref(false)
  const composing = ref(false)
  /** The text being saved right now (null: none). */
  const saving = ref<string | null>(null)
  const failed = ref(false)

  function focus() {
    editing.value = true
  }

  function input(value: string): string {
    text.value = composing.value ? value : oneLine(value)
    return text.value
  }

  function compositionStart() {
    composing.value = true
  }

  function compositionEnd(value: string): string {
    composing.value = false
    return input(value)
  }

  function reset() {
    text.value = saved()
    failed.value = false
  }

  async function blur(): Promise<void> {
    editing.value = false
    composing.value = false
    const value = oneLine(text.value)
    text.value = value
    if (value.trim() === saved()) {
      failed.value = false
      return
    }
    // The same text is on its way already (left again while saving).
    if (saving.value === value) return
    saving.value = value
    const ok = await save(value)
    if (saving.value === value) saving.value = null
    // The field holds something newer meanwhile: its own save decides what the field shows.
    if (text.value !== value) return
    failed.value = !ok
    // What the server keeps (trimmed), unless the field is being edited again.
    if (ok && !editing.value) text.value = value.trim()
  }

  function savedChanged() {
    if (editing.value || saving.value !== null || failed.value) return
    text.value = saved()
  }

  return { text, editing, composing, failed, focus, input, compositionStart, compositionEnd, reset, blur, savedChanged }
}
