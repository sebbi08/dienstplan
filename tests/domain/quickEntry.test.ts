import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { CodeDto, TemplateDto } from '../../shared/types/api'
import { usePlanSelection } from '../../app/composables/usePlanSelection'
import { de } from '../../app/locales/de'
import { entryApplyMode } from '../../app/utils/applyMode'
import { createLongPress, isQuickEntryKey, quickEntryCells, quickEntryHandlers, quickEntryInput } from '../../app/utils/quickEntry'
import { timeEntryInput } from '../../app/utils/timeEntry'
import { enterIntoTemplateCells } from '../../app/utils/weekTemplateEditor'

const codes: CodeDto[] = [{ id: 11, key: 'office', label: 'Büro', color: 'yellow', creditMode: 'timed', requiresTimes: true, sortOrder: 1 }]
const templates: TemplateDto[] = []

describe('the quick time entry of a cell', () => {
  it('makes the special shift the „Sonderdienst“ dialog makes from the same times', () => {
    const quick = quickEntryInput('7:30-14 P 11:30-12')
    const dialog = timeEntryInput({ start: '7:30', end: '14:00', breakStart: '11:30', breakEnd: '12:00', note: '', homeOffice: false }, null)
    expect(quick).toEqual(dialog)
    expect(quick).toEqual({ entry: { kind: 'special', start: 450, end: 840, breakStart: 690, breakEnd: 720, note: null, homeOffice: false } })
    expect(quickEntryInput('730-14')).toEqual({
      entry: { kind: 'special', start: 450, end: 840, breakStart: null, breakEnd: null, note: null, homeOffice: false },
    })
  })

  it('is always added to what the cells hold, without home office (the dialog\'s mode)', () => {
    const result = quickEntryInput('8-12')
    if (!('entry' in result)) throw new Error('refused')
    expect(entryApplyMode(result.entry, codes)).toBe('add')
    expect(result.entry.homeOffice).toBe(false)
  })

  it('goes into the week template editor exactly like the dialog\'s entry, naming a refused cell', () => {
    const names = new Map([[1, 'Anna']])
    const cells = [{ employeeId: 1, weekday: 5 }]
    const context = { templates, codes }
    const quick = quickEntryInput('9-13 P 11-11:30')
    const dialog = timeEntryInput({ start: '9', end: '13', breakStart: '11', breakEnd: '11:30', note: '', homeOffice: false }, null)
    if (!('entry' in quick) || !('entry' in dialog)) throw new Error('refused')
    expect(enterIntoTemplateCells([], cells, quick.entry, context, names)).toEqual(enterIntoTemplateCells([], cells, dialog.entry, context, names))
    const first = enterIntoTemplateCells([], cells, quick.entry, context, names)
    if (!('entries' in first)) throw new Error('refused')
    const overlap = quickEntryInput('12-15')
    if (!('entry' in overlap)) throw new Error('refused')
    expect(enterIntoTemplateCells(first.entries, cells, overlap.entry, context, names)).toMatchObject({ error: 'entries_overlap' })
    expect((enterIntoTemplateCells(first.entries, cells, overlap.entry, context, names) as { message: string }).message).toContain('Anna, Samstag')
  })

  it('says in German what is wrong', () => {
    expect(quickEntryInput('')).toEqual({ error: de.quickEntry.errors.empty })
    expect(quickEntryInput('7:30')).toEqual({ error: de.quickEntry.errors.format })
    expect(quickEntryInput('7:75-14')).toEqual({ error: de.common.invalidTime })
    expect(quickEntryInput('7:32-14')).toEqual({ error: de.spanErrors.not_on_grid })
    expect(quickEntryInput('14-7')).toEqual({ error: de.spanErrors.end_before_start })
    expect(quickEntryInput('7-14 P 13:30-14:30')).toEqual({ error: de.spanErrors.break_outside })
  })
})

describe('the cells a quick time entry goes into', () => {
  const selected = new Set(['1|2026-10-05', '1|2026-10-06', '2|2026-10-05'])
  it('keeps a multi-selection the cell belongs to, like the dialog', () => {
    expect(quickEntryCells(selected, '1|2026-10-06')).toEqual(selected)
  })
  it('takes the cell alone otherwise', () => {
    expect(quickEntryCells(selected, '3|2026-10-05')).toEqual(new Set(['3|2026-10-05']))
    expect(quickEntryCells(new Set(), '3|2026-10-05')).toEqual(new Set(['3|2026-10-05']))
  })
  it('opens with Enter or F2 on the focused cell', () => {
    expect(isQuickEntryKey({ key: 'Enter' })).toBe(true)
    expect(isQuickEntryKey({ key: 'F2' })).toBe(true)
    expect(isQuickEntryKey({ key: ' ' })).toBe(false)
    expect(isQuickEntryKey({ key: 'Enter', ctrlKey: true })).toBe(false)
  })
})

describe('the plan selection with the quick time entry', () => {
  beforeEach(() => {
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
  })
  afterEach(() => vi.unstubAllGlobals())
  const click = (detail: number, init: MouseEventInit = {}) => ({ detail, shiftKey: false, ctrlKey: false, metaKey: false, ...init }) as MouseEvent
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07']

  it('still selects one cell per click, a range with Shift and single cells with Ctrl', () => {
    const selection = usePlanSelection()
    selection.click(1, '2026-10-05', click(1), dates)
    expect([...selection.selected.value]).toEqual(['1|2026-10-05'])
    selection.click(1, '2026-10-07', click(1, { shiftKey: true }), dates)
    expect([...selection.selected.value]).toEqual(['1|2026-10-05', '1|2026-10-06', '1|2026-10-07'])
    selection.click(2, '2026-10-05', click(1, { ctrlKey: true }), dates)
    expect(selection.selected.value.size).toBe(4)
    selection.click(2, '2026-10-06', click(1), dates)
    expect([...selection.selected.value]).toEqual(['2|2026-10-06'])
  })

  it('keeps a multi-selection a double-clicked cell belongs to, although its clicks selected the cell alone', () => {
    const selection = usePlanSelection()
    selection.click(1, '2026-10-05', click(1), dates)
    selection.click(1, '2026-10-07', click(1, { shiftKey: true }), dates)
    // The two clicks of a double click on Tuesday, then the double click itself.
    selection.click(1, '2026-10-06', click(1), dates)
    selection.click(1, '2026-10-06', click(2), dates)
    expect(selection.selected.value.size).toBe(1)
    selection.selectForQuickEntry(1, '2026-10-06', true)
    expect([...selection.selected.value]).toEqual(['1|2026-10-05', '1|2026-10-06', '1|2026-10-07'])
  })

  it('takes a double-clicked cell outside the selection alone, and the focused cell for Enter/F2 or a long press', () => {
    const selection = usePlanSelection()
    selection.click(1, '2026-10-05', click(1), dates)
    selection.click(1, '2026-10-06', click(1, { ctrlKey: true }), dates)
    selection.click(2, '2026-10-07', click(1), dates)
    selection.click(2, '2026-10-07', click(2), dates)
    selection.selectForQuickEntry(2, '2026-10-07', true)
    expect([...selection.selected.value]).toEqual(['2|2026-10-07'])
    // No click before: the current selection counts.
    selection.click(1, '2026-10-05', click(1), dates)
    selection.click(1, '2026-10-06', click(1, { ctrlKey: true }), dates)
    selection.selectForQuickEntry(1, '2026-10-06', false)
    expect(selection.selected.value.size).toBe(2)
    selection.selectForQuickEntry(3, '2026-10-06', false)
    expect([...selection.selected.value]).toEqual(['3|2026-10-06'])
  })
})

describe('a long press on a touch screen', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const touch = (clientX = 10, clientY = 10) => ({ pointerType: 'touch', clientX, clientY })

  it('fires after 500 ms and swallows the click of the release, but not the next tap', () => {
    const onPress = vi.fn()
    const press = createLongPress(onPress)
    press.down(touch(), 'cell')
    vi.advanceTimersByTime(499)
    expect(onPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onPress).toHaveBeenCalledWith('cell')
    press.up()
    expect(press.consumeClick()).toBe(true)
    // A normal tap afterwards selects as before.
    press.down(touch(), 'cell')
    press.up()
    expect(press.consumeClick()).toBe(false)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a short tap, a mouse, or a finger that moves (scrolling)', () => {
    const onPress = vi.fn()
    const press = createLongPress(onPress)
    press.down(touch(), 'a')
    vi.advanceTimersByTime(200)
    press.up()
    vi.advanceTimersByTime(1000)
    press.down({ pointerType: 'mouse', clientX: 0, clientY: 0 }, 'b')
    vi.advanceTimersByTime(1000)
    press.down(touch(10, 10), 'c')
    press.move(touch(10, 40))
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
    expect(press.consumeClick()).toBe(false)
  })

  it('opens from a cell by double click, Enter/F2 or a long press, and leaves a double click on a chip\'s dialog alone', () => {
    const open = vi.fn()
    const handlers = quickEntryHandlers<string>(open)
    const cell = { contains: () => true, focus: vi.fn() } as unknown as HTMLElement
    const inner = (skip: boolean) => ({ closest: () => (skip ? {} : null) })
    handlers.dblclick({ currentTarget: cell, target: inner(false) } as unknown as MouseEvent, 'a')
    expect(open).toHaveBeenLastCalledWith('a', cell, true)
    handlers.dblclick({ currentTarget: cell, target: inner(true) } as unknown as MouseEvent, 'b')
    expect(open).toHaveBeenCalledTimes(1)
    const key = (k: string, target: unknown = cell) => ({ key: k, currentTarget: cell, target, preventDefault: vi.fn() }) as unknown as KeyboardEvent
    handlers.keydown(key('F2'), 'c')
    expect(open).toHaveBeenLastCalledWith('c', cell, false)
    handlers.keydown(key('Enter', {}), 'd') // Enter on a button inside the cell is the button's
    handlers.keydown(key('a'), 'e')
    expect(open).toHaveBeenCalledTimes(2)
    handlers.pointerdown({ ...touch(), currentTarget: cell } as unknown as PointerEvent, 'f')
    vi.advanceTimersByTime(500)
    expect(open).toHaveBeenLastCalledWith('f', cell, false)
    // A later press on a cell without the quick entry ends it: its click is a normal click again.
    handlers.pointerdown({ ...touch(), currentTarget: cell } as unknown as PointerEvent, null)
    expect(handlers.consumeClick()).toBe(false)
  })

  it('keeps the browser menu of a long press away while it runs', () => {
    const press = createLongPress(vi.fn())
    const menu = { preventDefault: vi.fn() }
    press.contextMenu(menu)
    expect(menu.preventDefault).not.toHaveBeenCalled()
    press.down(touch(), 'a')
    press.contextMenu(menu)
    expect(menu.preventDefault).toHaveBeenCalledTimes(1)
  })
})
