import { nextTick } from 'vue'

/** The element id of an ▲/▼ button of a list entry (`base` names the entry, e.g. `template-12`). */
export const orderArrowId = (base: string, direction: -1 | 1): string => `${base}-${direction < 0 ? 'up' : 'down'}`

/**
 * After a move, puts the keyboard focus back on the arrow just used (the entry moved, the button was disabled while
 * saving), or on the other arrow when the entry reached an end of the list, so ▲/▼ can be pressed again at once.
 */
export function focusOrderArrow(base: string, direction: -1 | 1): void {
  nextTick(() => {
    const button = (dir: -1 | 1) => document.getElementById(orderArrowId(base, dir)) as HTMLButtonElement | null
    const wanted = button(direction)
    const target = wanted && !wanted.disabled ? wanted : button(direction < 0 ? 1 : -1)
    target?.focus()
  })
}
