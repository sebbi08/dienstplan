import { describe, expect, it } from 'vitest'
import { creditedMinutes, mayStampVia, plannedBreakMinutes } from '../../shared/domain/stamping'

const day = (...spans: [number, number][]) => spans.map(([start, end]) => ({ start, end }))

describe('stamping options', () => {
  it('always allows the tablet, and the own phone only with "both"', () => {
    expect([mayStampVia('both', 'self'), mayStampVia('both', 'terminal')]).toEqual([true, true])
    expect([mayStampVia('tablet', 'self'), mayStampVia('tablet', 'terminal')]).toEqual([false, true])
  })
  it('sums the planned breaks of a day', () => {
    expect(plannedBreakMinutes([
      { kind: 'shift', start: 465, end: 960, breakStart: 700, breakEnd: 730 },
      { kind: 'break', start: 900, end: 915, breakStart: null, breakEnd: null },
      { kind: 'code', start: 450, end: 570, breakStart: null, breakEnd: null },
    ])).toBe(45)
  })
  it('counts clocked time as it is when breaks are clocked', () => {
    expect(creditedMinutes(day([465, 700], [730, 960]), 'stamp', 30)).toBe(465)
    expect(creditedMinutes(day([465, 960]), 'stamp', 30)).toBe(495)
  })
  it('deducts the planned break in full when breaks are automatic, without deducting twice', () => {
    expect(creditedMinutes(day([465, 960]), 'auto', 30)).toBe(465) // 8:15 present, 30 min deducted
    expect(creditedMinutes(day([465, 700], [730, 960]), 'auto', 30)).toBe(465) // clocked anyway: nothing more
    expect(creditedMinutes(day([465, 700], [715, 960]), 'auto', 30)).toBe(465) // 15 clocked + 15 deducted
    expect(creditedMinutes(day([465, 960]), 'auto', 0)).toBe(465) // no planned break: legal 30 min
    expect(creditedMinutes(day([420, 720]), 'auto', 0)).toBe(300) // 5 h: no break needed
    expect(creditedMinutes([], 'auto', 30)).toBe(0)
  })
})
