import { parseQuickTime, type QuickTimeError } from '#shared/domain/quickTime'
import { formatTime } from '#shared/domain/time'
import type { EntryInput } from '#shared/types/api'
import type { LawEntry } from '#shared/domain/workingTimeLaw'
import { de } from '~/locales/de'
import { timeEntryInput } from './timeEntry'
import { exceedsMaxDailyWith } from './workTime'

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
 * § 3 ArbZG, as the „Sonderdienst“ dialog hints it (exceedsMaxDailyWith): the typed special shift with the other entries
 * of a cell's day is more than 10 hours (one of several cells is enough). False while the text is not a valid span, and
 * without day entries (the template editor's dialog has no such hint either).
 */
export function quickEntryMaxDaily(text: string, days: LawEntry[][]): boolean {
  const parsed = parseQuickTime(text)
  if ('error' in parsed) return false
  const asTyped = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
  const { start, end, breakStart, breakEnd } = parsed.span
  return exceedsMaxDailyWith(
    { start: asTyped(start), end: asTyped(end), breakStart: asTyped(breakStart), breakEnd: asTyped(breakEnd) },
    { kind: 'special', creditMode: 'timed' }, days,
  )
}

/**
 * The editor's tap on a touch screen adds or removes the cell (there is no Ctrl key): a Ctrl click that keeps the tap's
 * `detail`, so the second tap of a double tap is known as such (usePlanSelection keeps the selection before the first).
 */
export function touchTapAsToggle(event: MouseEvent): MouseEvent {
  if (!('pointerType' in event) || event.pointerType !== 'touch') return event
  return { ctrlKey: true, shiftKey: false, metaKey: false, altKey: false, detail: event.detail } as MouseEvent
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
const STEPS: Record<ArrowKey, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
const isArrowKey = (key: string): key is ArrowKey => key in STEPS

/**
 * The cell an arrow key moves to in a grid of cell keys (rows × columns; null = a place that cannot be focused, skipped):
 * the next focusable one in that direction, null at the edge, for other keys or an unknown cell.
 */
export function gridStep(grid: (string | null)[][], current: string, key: string): string | null {
  if (!isArrowKey(key)) return null
  const row = grid.findIndex(cells => cells.includes(current))
  if (row < 0) return null
  const [rowStep, columnStep] = STEPS[key]
  let [r, c] = [row, grid[row]!.indexOf(current)]
  for (;;) {
    r += rowStep
    c += columnStep
    if (r < 0 || r >= grid.length || c < 0 || c >= (grid[r]?.length ?? 0)) return null
    const next = grid[r]![c]
    if (next) return next
  }
}

/** The grid's one tab stop (roving tabindex): the cell focused last while it is still there, else the first cell. */
export function rovingStop(grid: (string | null)[][], remembered: string | null): string | null {
  const cells = grid.flat().filter((key): key is string => key !== null)
  return remembered !== null && cells.includes(remembered) ? remembered : (cells[0] ?? null)
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
 * link or field inside the cell, or on an element marked `data-quick-skip` (a chip opening its edit dialog), is theirs;
 * Shift/Ctrl/Cmd+double click stays a selection gesture. `move` gets the arrow keys pressed on a focused cell (the
 * grid's roving tab stop moves).
 */
export function quickEntryHandlers<T>(
  open: (target: T, element: HTMLElement, afterDoubleClick: boolean) => void, move?: (target: T, key: ArrowKey) => void,
) {
  const longPress = createLongPress<{ target: T; element: HTMLElement }>(({ target, element }) => open(target, element, false))
  const FIELDS = 'button, a, input, textarea, select'
  return {
    dblclick(event: MouseEvent, target: T) {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      const element = event.currentTarget as HTMLElement
      const inner = (event.target as HTMLElement | null)?.closest(`${FIELDS}, [data-quick-skip]`)
      if (inner && element.contains(inner)) return
      open(target, element, true)
    },
    /** The second press of a double click would select the cell's text; a single press (and any field) stays as it is. */
    mousedown(event: MouseEvent) {
      if (event.detail > 1 && !(event.target as HTMLElement | null)?.closest(FIELDS)) event.preventDefault()
    },
    keydown(event: KeyboardEvent, target: T) {
      if (event.target !== event.currentTarget) return
      if (isArrowKey(event.key) && move && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault()
        move(target, event.key)
        return
      }
      if (!isQuickEntryKey(event)) return
      event.preventDefault()
      open(target, event.currentTarget as HTMLElement, false)
    },
    /** The browser's text selection of a long press stays away while the press runs (text stays selectable otherwise). */
    selectstart: longPress.contextMenu,
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
