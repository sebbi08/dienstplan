import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { CodeDto, TemplateDto } from '../../shared/types/api'
import { usePlanSelection } from '../../app/composables/usePlanSelection'
import { de } from '../../app/locales/de'
import { entryApplyMode } from '../../app/utils/applyMode'
import {
  createLongPress, gridStep, isQuickEntryKey, quickEntryCells, quickEntryHandlers, quickEntryInput, quickEntryMaxDaily, rovingStop,
  touchTapAsToggle,
} from '../../app/utils/quickEntry'
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

describe('the § 3 ArbZG hint of the quick time entry', () => {
  // A day with 7:00–13:15 already planned.
  const morning = [{ kind: 'shift' as const, creditMode: 'timed' as const, start: 420, end: 795, breakStart: null, breakEnd: null }]
  it('says more than 10 hours with the cell\'s other entries, like the dialog', () => {
    expect(quickEntryMaxDaily('13:15-18', [morning])).toBe(true) // 6:15 + 4:45 = 11 h
    expect(quickEntryMaxDaily('13:15-17', [morning])).toBe(false) // exactly 10 h
    expect(quickEntryMaxDaily('13:15-18', [[], morning])).toBe(true) // one of several cells is enough
    expect(quickEntryMaxDaily('6-17 P 12-12:30', [[]])).toBe(true)
    expect(quickEntryMaxDaily('6-16:30 P 12-12:30', [[]])).toBe(false)
  })
  it('stays quiet while the text is incomplete or wrong, and without day entries (the template editor)', () => {
    expect(quickEntryMaxDaily('13:15-', [morning])).toBe(false)
    expect(quickEntryMaxDaily('18-13:15', [morning])).toBe(false)
    expect(quickEntryMaxDaily('13:15-18', [])).toBe(false)
  })
})

describe('moving between the cells of a grid with the arrow keys (one tab stop per grid)', () => {
  // Two days × three columns; null = no cell to focus (an attendance column, a helper's day elsewhere).
  const grid = [['a1', null, 'a3'], ['b1', 'b2', null]]
  it('goes to the neighbour in the direction, skipping cells that cannot be focused', () => {
    expect(gridStep(grid, 'a1', 'ArrowRight')).toBe('a3')
    expect(gridStep(grid, 'a1', 'ArrowDown')).toBe('b1')
    expect(gridStep(grid, 'b2', 'ArrowUp')).toBeNull() // nothing above b2
    expect(gridStep(grid, 'b2', 'ArrowLeft')).toBe('b1')
    expect(gridStep(grid, 'a3', 'ArrowDown')).toBeNull()
  })
  it('stays at the edge and ignores other keys and unknown cells', () => {
    expect(gridStep(grid, 'a1', 'ArrowLeft')).toBeNull()
    expect(gridStep(grid, 'b1', 'ArrowDown')).toBeNull()
    expect(gridStep(grid, 'a1', 'Tab')).toBeNull()
    expect(gridStep(grid, 'x', 'ArrowDown')).toBeNull()
  })
  it('makes the remembered cell the tab stop, else the first cell', () => {
    expect(rovingStop(grid, 'b2')).toBe('b2')
    expect(rovingStop(grid, 'gone')).toBe('a1')
    expect(rovingStop(grid, null)).toBe('a1')
    expect(rovingStop([[null]], null)).toBeNull()
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

  it('restores the selection after a double tap in the template editor, where a tap toggles the cell', () => {
    const selection = usePlanSelection()
    const tap = (detail: number) => touchTapAsToggle({ pointerType: 'touch', detail } as PointerEvent)
    selection.click(1, '2026-10-05', tap(1), dates)
    selection.click(1, '2026-10-06', tap(1), dates)
    // A double tap on Tuesday: the first tap toggles it off, the second on again.
    selection.click(1, '2026-10-06', tap(1), dates)
    selection.click(1, '2026-10-06', tap(2), dates)
    selection.selectForQuickEntry(1, '2026-10-06', true)
    expect([...selection.selected.value]).toEqual(['1|2026-10-05', '1|2026-10-06'])
    // A double tap on a cell outside the selection takes it alone.
    selection.click(2, '2026-10-07', tap(1), dates)
    selection.click(2, '2026-10-07', tap(2), dates)
    selection.selectForQuickEntry(2, '2026-10-07', true)
    expect([...selection.selected.value]).toEqual(['2|2026-10-07'])
    // A mouse click stays as it is.
    const mouse = { pointerType: 'mouse', detail: 1, ctrlKey: false } as PointerEvent
    expect(touchTapAsToggle(mouse)).toBe(mouse)
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
    // Shift/Ctrl+double click is a selection gesture, not a quick entry.
    handlers.dblclick({ currentTarget: cell, target: inner(false), ctrlKey: true } as unknown as MouseEvent, 'b')
    handlers.dblclick({ currentTarget: cell, target: inner(false), shiftKey: true } as unknown as MouseEvent, 'b')
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

  it('moves with the arrow keys from the focused cell and keeps the page from scrolling', () => {
    const move = vi.fn()
    const handlers = quickEntryHandlers<string>(vi.fn(), move)
    const cell = {} as HTMLElement
    const key = (k: string, target: unknown = cell) => ({ key: k, currentTarget: cell, target, preventDefault: vi.fn() }) as unknown as KeyboardEvent
    const down = key('ArrowDown')
    handlers.keydown(down, 'a')
    expect(move).toHaveBeenCalledWith('a', 'ArrowDown')
    expect(down.preventDefault).toHaveBeenCalled()
    handlers.keydown(key('ArrowUp', {}), 'a') // from a button inside the cell: the button's
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('keeps a double click from selecting the cell\'s text, but leaves single clicks and fields alone', () => {
    const handlers = quickEntryHandlers<string>(vi.fn())
    const press = (detail: number, field = false) => ({
      detail, preventDefault: vi.fn(), target: { closest: () => (field ? {} : null) },
    }) as unknown as MouseEvent
    const single = press(1)
    handlers.mousedown(single)
    expect(single.preventDefault).not.toHaveBeenCalled()
    const second = press(2)
    handlers.mousedown(second)
    expect(second.preventDefault).toHaveBeenCalled()
    const inField = press(2, true)
    handlers.mousedown(inField)
    expect(inField.preventDefault).not.toHaveBeenCalled()
  })

  it('keeps the browser\'s text selection of a long press away only while the press runs', () => {
    const handlers = quickEntryHandlers<string>(vi.fn())
    const select = { preventDefault: vi.fn() }
    handlers.selectstart(select)
    expect(select.preventDefault).not.toHaveBeenCalled()
    handlers.pointerdown({ ...touch(), currentTarget: {} } as unknown as PointerEvent, 'a')
    handlers.selectstart(select)
    expect(select.preventDefault).toHaveBeenCalledTimes(1)
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
