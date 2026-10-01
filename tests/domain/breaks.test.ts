import { describe, expect, it } from 'vitest'
import { dayCredit } from '../../shared/domain/balance'
import { breakConflict } from '../../shared/domain/breaks'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import { describeEntry } from '../../shared/domain/describe'
import type { DomainEntry } from '../../shared/domain/types'
import { code, F2, M, shift } from '../helpers/entries'

const date = '2026-10-06'
const extraBreak = (start: number, end: number): DomainEntry => shift(1, date, start, end, null, null, { kind: 'break', countsAsStaff: false })

describe('additional breaks', () => {
  it('are subtracted from the worked time', () => {
    expect(dayCredit([shift(1, date, ...M), extraBreak(900, 915)], 468)).toBe(465 - 15)
  })
  it('do not change a day credited with the daily target', () => {
    expect(dayCredit([code(1, date, 'sick', 'daily_target'), extraBreak(900, 915)], 468)).toBe(468)
  })
  it('show as break in the day overview and are not counted as present', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [shift(1, date, ...M), extraBreak(900, 915)] }], false)
    const slot = (900 - 420) / 15
    expect(overview.rows[0]!.states[slot]).toBe('break')
    expect(overview.present[slot]).toBe(0)
    expect(overview.rows[0]!.states[slot + 1]).toBe('work')
  })
  it('are described in brackets', () => {
    expect(describeEntry({ kind: 'break', start: 900, end: 915 }, null)).toBe('[15:00–15:15]')
  })
})

describe('breakConflict', () => {
  const day = [shift(1, date, ...F2)] // 7:30–15:45, break 11:40–12:10

  it('accepts a break inside working time that overlaps no other break', () => {
    expect(breakConflict(day, 900, 915)).toBeNull()
  })
  it('rejects a break outside every working entry', () => {
    expect(breakConflict(day, 940, 960)).toBe('break_outside_work')
    expect(breakConflict([code(1, date, 'sick', 'daily_target')], 600, 615)).toBe('break_outside_work')
  })
  it('rejects a break overlapping the entry break or another additional break', () => {
    expect(breakConflict(day, 720, 740)).toBe('break_overlap')
    expect(breakConflict([...day, extraBreak(900, 915)], 910, 925)).toBe('break_overlap')
  })
  it('ignores the old break of the entry whose break is being changed', () => {
    expect(breakConflict(day, 710, 740, { ignoreBreakOf: day[0] })).toBeNull()
    expect(breakConflict([...day, extraBreak(900, 915)], 900, 930, { ignoreBreakOf: day[0] })).toBe('break_overlap')
  })
})
