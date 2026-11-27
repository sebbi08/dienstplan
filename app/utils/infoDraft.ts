import { ref } from 'vue'

/** One paragraph: line breaks (pasted ones too) become spaces. */
export const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ')

/**
 * What an Info field of the plan (PlanInfoField) shows while it is edited: its own draft, not the saved text. A re-render
 * of the field (its two-line state, focus, a reload of the plan) never puts the saved text back over what is being typed.
 *
 * - `text` is what the field shows; `input` takes what was typed (line breaks become spaces, not while an input method
 *   composes a word) and returns the text the field should hold.
 * - `blur` saves when the text was changed since the field got the focus (or its last save failed) and differs from what
 *   the server has or is about to get (the server trims, so spaces at the ends are no change). Leaving the field without
 *   a change never saves. The draft stays visible until the save is through; when it fails, the typed text stays in the
 *   field (`failed`), ready to try again.
 * - `reset` (Escape) puts back what the server has – or the text on its way there while a save is running, never the
 *   text from before that save.
 * - Once no save is running, a field that is neither edited nor failed shows what the server has: the last confirmed
 *   save or the saved text after a reload (`savedChanged`), whichever came last.
 */
export function createInfoDraft(saved: () => string, save: (text: string) => Promise<boolean>) {
  const text = ref(saved())
  const editing = ref(false)
  const composing = ref(false)
  /** The text being saved right now, the newest one (null: none). */
  const saving = ref<string | null>(null)
  const failed = ref(false)
  /** What the server has as far as the field knows: the saved text, or a save confirmed since (the props may lag). */
  let confirmed = saved()
  /** Saves are numbered: a save that ends late never overrides what a newer one confirmed. */
  let lastSave = 0
  let confirmedSave = 0
  /** The text when the field got the focus: leaving it unchanged saves nothing. */
  let atFocus = text.value

  /** What the server has or is about to get. */
  const baseline = () => (saving.value !== null ? saving.value.trim() : confirmed)

  /** No save running, not edited, nothing failed: the field shows what the server has. */
  function settle() {
    if (!editing.value && saving.value === null && !failed.value) text.value = confirmed
  }

  function focus() {
    editing.value = true
    atFocus = text.value
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
    text.value = baseline()
    failed.value = false
  }

  async function blur(): Promise<void> {
    editing.value = false
    composing.value = false
    const value = oneLine(text.value)
    text.value = value
    const changed = value !== atFocus
    if ((!changed && !failed.value) || value.trim() === baseline()) {
      failed.value = false
      settle()
      return
    }
    // The same text is on its way already (left again while saving).
    if (saving.value === value) return
    saving.value = value
    lastSave += 1
    const number = lastSave
    const ok = await save(value)
    if (ok && number > confirmedSave) {
      confirmed = value.trim()
      confirmedSave = number
    }
    if (saving.value === value) saving.value = null
    // The outcome belongs to the field only while it still holds this text; a newer text has its own save.
    if (text.value === value) failed.value = !ok
    settle()
  }

  function savedChanged() {
    confirmed = saved()
    settle()
  }

  return { text, editing, composing, failed, focus, input, compositionStart, compositionEnd, reset, blur, savedChanged }
}
