import { parseQuickTime, type QuickTimeError } from '#shared/domain/quickTime'
import { formatTime } from '#shared/domain/time'
import type { EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { timeEntryInput } from './timeEntry'

/**
 * Quick time entry in the plan and the week template editor: a double click (desktop), a long press (touch), Enter or
 * F2 on a focused cell opens a small field at the cell; „7:30-14 P 11:30-12“ becomes the special shift the
 * „Sonderdienst“ dialog makes, and goes the dialog's way (the plan's onEntry, the editor's enter).
 */

function quickTimeErrorText(error: QuickTimeError): string {
  if (error === 'empty' || error === 'format') return de.quickEntry.errors[error]
  return error === 'invalid_time' ? de.common.invalidTime : de.spanErrors[error]
}

/**
 * The special shift a typed time span gives, made by the „Sonderdienst“ dialog's own rules (timeEntryInput: no note, no
 * home office), or the German text of what is wrong.
 */
export function quickEntryInput(text: string): { entry: EntryInput } | { error: string } {
  const parsed = parseQuickTime(text)
  if ('error' in parsed) return { error: quickTimeErrorText(parsed.error) }
  const { start, end, breakStart, breakEnd } = parsed.span
  const asTyped = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
  return timeEntryInput({
    start: asTyped(start), end: asTyped(end), breakStart: asTyped(breakStart), breakEnd: asTyped(breakEnd), note: '', homeOffice: false,
  }, null)
}

/**
 * The cells the entry goes into: the selection when the cell belongs to it (as the dialog would enter it), otherwise the
 * cell alone. For a double click, `selected` is the selection before its first click (which selected the cell alone).
 */
export function quickEntryCells(selected: ReadonlySet<string>, key: string): Set<string> {
  return selected.has(key) ? new Set(selected) : new Set([key])
}

/** Enter or F2 (without Ctrl, Alt or Meta) on a focused cell opens the field: the keyboard's double click. */
export function isQuickEntryKey(event: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'>>): boolean {
  return (event.key === 'Enter' || event.key === 'F2') && !event.ctrlKey && !event.altKey && !event.metaKey
}

type PointerLike = Pick<PointerEvent, 'pointerType' | 'clientX' | 'clientY'>

/**
 * A long press of a finger (~500 ms without moving more than a few pixels, so scrolling never fires it); a mouse never
 * does (it has the double click). The click a browser sends on release is swallowed (consumeClick), so the press does
 * not also select or toggle the cell; the next press starts afresh.
 */
export function createLongPress<T>(onPress: (target: T) => void, delay = 500, tolerance = 10) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let origin: { x: number; y: number } | null = null
  let pressed = false

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    origin = null
  }

  return {
    down(event: PointerLike, target: T) {
      cancel()
      pressed = false
      if (event.pointerType !== 'touch') return
      origin = { x: event.clientX, y: event.clientY }
      timer = setTimeout(() => {
        timer = null
        pressed = true
        onPress(target)
      }, delay)
    },
    move(event: PointerLike) {
      if (timer !== null && origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > tolerance) cancel()
    },
    up: cancel,
    cancel,
    /** The browser's own long-press menu (text selection, „Link öffnen“) stays away while a press runs or just fired. */
    contextMenu(event: Pick<Event, 'preventDefault'>) {
      if (timer !== null || pressed) event.preventDefault()
    },
    /** True once for the click that follows a long press. */
    consumeClick(): boolean {
      const was = pressed
      pressed = false
      return was
    },
  }
}

/**
 * The event handlers of a cell that opens the quick entry (plan grid, template editor): `open` gets the cell's target,
 * the cell element (where the field shows) and whether a double click selected it first. A double click on a button,
 * link or field inside the cell, or on an element marked `data-quick-skip` (a chip opening its edit dialog), is theirs.
 */
export function quickEntryHandlers<T>(open: (target: T, element: HTMLElement, afterDoubleClick: boolean) => void) {
  const longPress = createLongPress<{ target: T; element: HTMLElement }>(({ target, element }) => open(target, element, false))
  return {
    dblclick(event: MouseEvent, target: T) {
      const element = event.currentTarget as HTMLElement
      const inner = (event.target as HTMLElement | null)?.closest('button, a, input, textarea, select, [data-quick-skip]')
      if (inner && element.contains(inner)) return
      open(target, element, true)
    },
    keydown(event: KeyboardEvent, target: T) {
      if (event.target !== event.currentTarget || !isQuickEntryKey(event)) return
      event.preventDefault()
      open(target, event.currentTarget as HTMLElement, false)
    },
    /** `target` null: a cell without the quick entry, where a press only ends what an earlier one left. */
    pointerdown(event: PointerEvent, target: T | null) {
      if (target === null) {
        longPress.cancel()
        longPress.consumeClick()
        return
      }
      longPress.down(event, { target, element: event.currentTarget as HTMLElement })
    },
    pointermove: longPress.move,
    pointerup: longPress.up,
    pointercancel: longPress.cancel,
    contextmenu: longPress.contextMenu,
    consumeClick: longPress.consumeClick,
  }
}
