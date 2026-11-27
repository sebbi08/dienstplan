import { describe, expect, it } from 'vitest'
import { ref, watchEffect } from 'vue'
import { createInfoDraft, oneLine } from '../../app/utils/infoDraft'

/** A save the test settles by hand: `settle(true)` = saved, `settle(false)` = failed (network, 4xx). */
function manualSave() {
  const calls: string[] = []
  let settle: (ok: boolean) => void = () => {}
  const save = (text: string) => {
    calls.push(text)
    return new Promise<boolean>((resolve) => {
      settle = resolve
    })
  }
  return { calls, save, settle: (ok: boolean) => settle(ok) }
}

/**
 * The Info field as Vue renders it: the textarea's value is patched from the draft on every re-render (Vue patches
 * `value` on each render; the DOM is only written when it differs), and the two-line state („…“) re-renders as well.
 * Typing writes the field first, then the draft takes it – as the browser and PlanInfoField's input handler do.
 */
function renderedField(saved: { value: string }, save: (text: string) => Promise<boolean>) {
  const draft = createInfoDraft(() => saved.value, save)
  const field = { value: '' }
  const clamped = ref(false)
  let renders = 0
  watchEffect(() => {
    renders += 1
    // The template reads the draft, the two-line state and the focus.
    void clamped.value
    void draft.editing.value
    if (field.value !== draft.text.value) field.value = draft.text.value
  }, { flush: 'sync' })
  function type(characters: string) {
    for (const character of characters) {
      field.value += character
      field.value = draft.input(field.value)
      // About 70 characters fill two lines of the column: the „…“ state flips and the field re-renders.
      clamped.value = field.value.length > 70
    }
  }
  function backspace(count: number) {
    for (let index = 0; index < count; index += 1) {
      field.value = draft.input(field.value.slice(0, -1))
      clamped.value = field.value.length > 70
    }
  }
  return { draft, field, clamped, type, backspace, renders: () => renders }
}

describe('the Info field\'s draft (PlanInfoField)', () => {
  it('keeps every typed character while the field re-renders past two lines and back', () => {
    const saved = { value: '' }
    const { draft, field, type, backspace, renders } = renderedField(saved, manualSave().save)
    draft.focus()
    const text = 'Teamsitzung 15:00 im Turnraum, bitte Wochenplan mitbringen und die Liste für den Ausflug abgeben. '
      .repeat(3).slice(0, 200)
    type(text)
    expect(field.value).toBe(text)
    expect(draft.text.value).toBe(text)
    const before = renders()
    // Shortened back into two lines: the „…“ state flips again, the text stays as edited.
    backspace(150)
    expect(renders()).toBeGreaterThan(before)
    expect(field.value).toBe(text.slice(0, 50))
  })

  it('shows the draft until the save is through, even when the plan reloads with the old text meanwhile', async () => {
    const saved = { value: 'alt' }
    const save = manualSave()
    const { draft, field, type } = renderedField(saved, save.save)
    expect(field.value).toBe('alt')
    draft.focus()
    type(' und neu ')
    const left = draft.blur()
    expect(save.calls).toEqual(['alt und neu '])
    // A reload while saving (another change) still has the old text: the field keeps what was typed.
    draft.savedChanged()
    expect(field.value).toBe('alt und neu ')
    saved.value = 'alt und neu'
    save.settle(true)
    await left
    // The server trims: the field shows what it keeps.
    expect(field.value).toBe('alt und neu')
    expect(draft.failed.value).toBe(false)
  })

  it('keeps the typed text when the save fails, and saves it again on the next try', async () => {
    const saved = { value: 'alt' }
    const save = manualSave()
    const { draft, field, type } = renderedField(saved, save.save)
    draft.focus()
    type(', Elternabend')
    const first = draft.blur()
    save.settle(false)
    await first
    expect(draft.failed.value).toBe(true)
    expect(field.value).toBe('alt, Elternabend')
    // A reload with the saved text does not throw the typed text away.
    draft.savedChanged()
    expect(field.value).toBe('alt, Elternabend')
    // Click in, Enter (leaves the field): saved again, this time it works.
    draft.focus()
    const second = draft.blur()
    expect(save.calls).toEqual(['alt, Elternabend', 'alt, Elternabend'])
    saved.value = 'alt, Elternabend'
    save.settle(true)
    await second
    expect(draft.failed.value).toBe(false)
    expect(field.value).toBe('alt, Elternabend')
  })

  it('an earlier save that ends later does not hide that a newer text failed', async () => {
    const saved = { value: 'alt' }
    const first = manualSave()
    const second = manualSave()
    let call = 0
    const { draft, field, type } = renderedField(saved, text => (call++ === 0 ? first.save(text) : second.save(text)))
    draft.focus()
    type(' eins')
    const left1 = draft.blur()
    // Still saving (the plan reloads slowly), edited and left again: this save fails.
    draft.focus()
    type(' zwei')
    const left2 = draft.blur()
    second.settle(false)
    await left2
    first.settle(true)
    await left1
    expect(field.value).toBe('alt eins zwei')
    expect(draft.failed.value).toBe(true)
  })

  it('Escape while a save is running keeps the text on its way, and leaving the field again saves nothing', async () => {
    const saved = { value: '' }
    const save = manualSave()
    const { draft, field, type } = renderedField(saved, save.save)
    draft.focus()
    type('Ausflug')
    // Enter: the save is running (the plan reloads slowly).
    const left = draft.blur()
    expect(save.calls).toEqual(['Ausflug'])
    // Click back in and press Escape: not back to the empty text from before the save.
    draft.focus()
    draft.reset()
    expect(field.value).toBe('Ausflug')
    await draft.blur()
    // The reload brings the new text while the save is still running; then the save ends.
    saved.value = 'Ausflug'
    draft.savedChanged()
    save.settle(true)
    await left
    expect(field.value).toBe('Ausflug')
    expect(draft.failed.value).toBe(false)
    // A later click in and out without typing never saves (and so never deletes the text).
    draft.focus()
    await draft.blur()
    expect(save.calls).toEqual(['Ausflug'])
    expect(field.value).toBe('Ausflug')
  })

  it('Escape while a save is running that then fails shows the failed text', async () => {
    const saved = { value: '' }
    const save = manualSave()
    const { draft, field, type } = renderedField(saved, save.save)
    draft.focus()
    type('Ausflug')
    const left = draft.blur()
    draft.focus()
    draft.reset()
    await draft.blur()
    save.settle(false)
    await left
    expect(field.value).toBe('Ausflug')
    expect(draft.failed.value).toBe(true)
  })

  it('a save confirmed late never overrides a newer one', async () => {
    const saved = { value: 'alt' }
    const first = manualSave()
    const second = manualSave()
    let call = 0
    const { draft, field, type } = renderedField(saved, text => (call++ === 0 ? first.save(text) : second.save(text)))
    draft.focus()
    type(' eins')
    const left1 = draft.blur()
    draft.focus()
    type(' zwei')
    const left2 = draft.blur()
    second.settle(true)
    await left2
    first.settle(true)
    await left1
    expect(field.value).toBe('alt eins zwei')
    expect(draft.failed.value).toBe(false)
  })

  it('Escape puts the saved text back and saves nothing; a failed text is dropped with it', async () => {
    const saved = { value: 'alt' }
    const save = manualSave()
    const { draft, field, type } = renderedField(saved, save.save)
    draft.focus()
    type(' neu')
    draft.reset()
    await draft.blur()
    expect(field.value).toBe('alt')
    expect(save.calls).toEqual([])

    draft.focus()
    type(' neu')
    const left = draft.blur()
    save.settle(false)
    await left
    draft.focus()
    draft.reset()
    await draft.blur()
    expect(field.value).toBe('alt')
    expect(draft.failed.value).toBe(false)
  })

  it('saves nothing when only spaces at the ends changed, and once when left again while saving', async () => {
    const saved = { value: 'Ausflug' }
    const save = manualSave()
    const { draft, field, type } = renderedField(saved, save.save)
    draft.focus()
    type('  ')
    await draft.blur()
    expect(save.calls).toEqual([])
    // Nothing to save: the field shows what the server has.
    expect(field.value).toBe('Ausflug')

    draft.focus()
    type('!')
    const first = draft.blur()
    draft.focus()
    const second = draft.blur()
    expect(save.calls).toEqual(['Ausflug!'])
    save.settle(true)
    await Promise.all([first, second])
  })

  it('takes a new saved text over only while the field is not being edited', () => {
    const saved = { value: 'eins' }
    const { draft, field, type } = renderedField(saved, manualSave().save)
    saved.value = 'zwei'
    draft.savedChanged()
    expect(field.value).toBe('zwei')
    draft.focus()
    type(' und')
    saved.value = 'drei'
    draft.savedChanged()
    expect(field.value).toBe('zwei und')
  })

  it('leaves a word an input method composes alone, and makes one paragraph of it afterwards', () => {
    const saved = { value: '' }
    const { draft, field } = renderedField(saved, manualSave().save)
    draft.focus()
    draft.compositionStart()
    field.value = 'ka\nn'
    expect(draft.input(field.value)).toBe('ka\nn')
    expect(field.value).toBe('ka\nn')
    expect(draft.compositionEnd('kan\nji')).toBe('kan ji')
  })

  it('makes one paragraph of pasted line breaks', () => {
    expect(oneLine('Zeile 1\r\n  Zeile 2\nZeile 3')).toBe('Zeile 1 Zeile 2 Zeile 3')
  })
})
