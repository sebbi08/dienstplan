import { describe, expect, it } from 'vitest'
import { cellFillColor, cellKey, noteKey, parseCellKey } from '../../shared/domain/cells'
import { describeCell, describeCellDetailed, describeEntry } from '../../shared/domain/describe'

describe('describeEntry', () => {
  it('shows times for shifts and special shifts', () => {
    expect(describeEntry({ kind: 'shift', start: 450, end: 945 }, null)).toBe('7:30–15:45')
    expect(describeEntry({ kind: 'special', start: 840, end: 1080 }, null)).toBe('14:00–18:00')
  })
  it('shows the code label, with times when present', () => {
    expect(describeEntry({ kind: 'code', start: null, end: null }, 'Krank')).toBe('Krank')
    expect(describeEntry({ kind: 'code', start: 450, end: 570 }, 'VZ')).toBe('VZ 7:30–9:30')
  })
  it('joins several entries of a cell', () => {
    expect(describeCell([{ label: 'VZ 7:30–9:30' }, { label: '9:30–15:45' }])).toBe('VZ 7:30–9:30 + 9:30–15:45')
    expect(describeCell([])).toBe('—')
  })
})

describe('cell keys', () => {
  it('round-trips cell keys', () => {
    expect(cellKey(3, '2026-10-05')).toBe('3|2026-10-05')
    expect(parseCellKey('3|2026-10-05')).toEqual({ employeeId: 3, date: '2026-10-05' })
    expect(noteKey('info1', '2026-10-05')).toBe('info1|2026-10-05')
  })
})

describe('cellFillColor', () => {
  const sick = { kind: 'code' as const, start: null, color: 'gray' }
  const prepTime = { kind: 'code' as const, start: 450, color: 'green' }
  const shift = { kind: 'shift' as const, start: 570, color: 'neutral' }

  it('fills the cell with the color of a full-day code', () => {
    expect(cellFillColor([sick])).toBe('gray')
  })
  it('lets a full-day code win over other entries of the day', () => {
    expect(cellFillColor([shift, sick])).toBe('gray')
  })
  it('fills the cell when it only contains timed codes', () => {
    expect(cellFillColor([prepTime])).toBe('green')
  })
  it('keeps the cell unfilled when a timed code is combined with a shift', () => {
    expect(cellFillColor([prepTime, shift])).toBeNull()
  })
  it('keeps empty and shift-only cells unfilled', () => {
    expect(cellFillColor([])).toBeNull()
    expect(cellFillColor([shift])).toBeNull()
  })
})

describe('describeCellDetailed', () => {
  it('includes short label, break and note', () => {
    expect(describeCellDetailed([
      { shortLabel: 'S', label: '8:45–17:00', breakStart: 730, breakEnd: 760, note: null },
      { shortLabel: null, label: 'VZ 7:30–8:30', breakStart: null, breakEnd: null, note: 'Elterngespräch' },
    ])).toBe('S 8:45–17:00 [12:10–12:40] + VZ 7:30–8:30 · Elterngespräch')
    expect(describeCellDetailed([])).toBe('—')
  })
})
