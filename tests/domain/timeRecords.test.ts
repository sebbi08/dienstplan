import { describe, expect, it } from 'vitest'
import { breakMinutes, breakRuleViolated, nowInBerlin, recordedMinutes } from '../../shared/domain/timeRecords'

const span = (start: number, end: number | null) => ({ start, end })

describe('recordedMinutes', () => {
  it('sums closed records and ignores open ones', () => {
    expect(recordedMinutes([span(462, 700), span(730, 963)])).toBe(238 + 233)
    expect(recordedMinutes([span(462, 700), span(730, null)])).toBe(238)
    expect(recordedMinutes([])).toBe(0)
  })
})

describe('breaks', () => {
  it('counts only gaps of at least 15 minutes between closed records', () => {
    expect(breakMinutes([span(420, 700), span(730, 900)])).toBe(30)
    expect(breakMinutes([span(420, 700), span(710, 900)])).toBe(0)
    expect(breakMinutes([span(730, 900), span(420, 700)])).toBe(30)
  })
  it('flags more than 6 h without 30 min and more than 9 h without 45 min', () => {
    expect(breakRuleViolated([span(420, 780)])).toBe(false) // exactly 6 h
    expect(breakRuleViolated([span(420, 781)])).toBe(true)
    expect(breakRuleViolated([span(420, 700), span(730, 980)])).toBe(false) // 8:50 h, 30 min break
    expect(breakRuleViolated([span(420, 700), span(730, 1020)])).toBe(true) // 9:30 h, 30 min break
    expect(breakRuleViolated([span(420, 700), span(745, 1035)])).toBe(false) // 9:30 h, 45 min break
    expect(breakRuleViolated([span(420, 710), span(710, 1000)])).toBe(true) // 10 min gap does not count
  })
})

describe('nowInBerlin', () => {
  it('returns Berlin wall-clock date and minutes in summer and winter time', () => {
    expect(nowInBerlin(new Date('2026-07-01T05:42:00Z'))).toEqual({ date: '2026-07-01', minutes: 462 })
    expect(nowInBerlin(new Date('2026-12-01T06:42:00Z'))).toEqual({ date: '2026-12-01', minutes: 462 })
    expect(nowInBerlin(new Date('2026-10-25T00:30:00Z'))).toEqual({ date: '2026-10-25', minutes: 150 }) // still CEST
    expect(nowInBerlin(new Date('2026-10-25T01:30:00Z'))).toEqual({ date: '2026-10-25', minutes: 150 }) // CET again
    expect(nowInBerlin(new Date('2026-12-31T23:30:00Z'))).toEqual({ date: '2027-01-01', minutes: 30 })
  })
})
