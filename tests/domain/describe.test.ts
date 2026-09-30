import { describe, expect, it } from 'vitest'
import { cellKey, noteKey, parseCellKey } from '../../shared/domain/cells'
import { describeCell, describeEntry } from '../../shared/domain/describe'

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
