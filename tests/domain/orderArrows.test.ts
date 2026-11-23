import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { focusOrderArrow, orderArrowId } from '../../app/utils/orderArrows'

/** Stand-ins for the ▲/▼ buttons of one entry (no DOM in the tests). */
function arrows(disabled: { up?: boolean; down?: boolean } = {}) {
  const focused: string[] = []
  const button = (id: string, isDisabled: boolean) => ({ disabled: isDisabled, focus: () => focused.push(id) })
  const buttons: Record<string, ReturnType<typeof button>> = {
    'template-7-up': button('template-7-up', disabled.up ?? false),
    'template-7-down': button('template-7-down', disabled.down ?? false),
  }
  globalThis.document = { getElementById: (id: string) => buttons[id] ?? null } as unknown as Document
  return focused
}

describe('order arrows', () => {
  afterEach(() => {
    delete (globalThis as { document?: Document }).document
  })

  it('names the buttons of an entry by direction', () => {
    expect(orderArrowId('template-7', -1)).toBe('template-7-up')
    expect(orderArrowId('form-template-3', 1)).toBe('form-template-3-down')
  })

  it('puts the focus back on the arrow used, or on the other one at an end of the list', async () => {
    const focused = arrows()
    focusOrderArrow('template-7', -1)
    await nextTick()
    expect(focused).toEqual(['template-7-up'])
    const atTop = arrows({ up: true })
    focusOrderArrow('template-7', -1)
    await nextTick()
    expect(atTop).toEqual(['template-7-down'])
    const atBottom = arrows({ down: true })
    focusOrderArrow('template-7', 1)
    await nextTick()
    expect(atBottom).toEqual(['template-7-up'])
  })

  it('does nothing when the entry is gone', async () => {
    arrows()
    expect(() => focusOrderArrow('template-99', 1)).not.toThrow()
    await nextTick()
  })
})
