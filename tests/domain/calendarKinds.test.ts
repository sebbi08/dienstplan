import { describe, expect, it } from 'vitest'
import { absenceDates, legendShowsKind, presentKinds } from '../../app/utils/calendarKinds'

describe('the calendar legend', () => {
  it('lists „Mutterschutz / Beschäftigungsverbot“ only when such a day is in the calendar (only viewers with the right get them)', () => {
    const masked = presentKinds({ 1: { '2026-11-17': 'absent', '2026-11-18': 'vacation' } })
    expect(legendShowsKind('maternity', masked)).toBe(false)
    expect(legendShowsKind('absent', masked)).toBe(true)
    expect(legendShowsKind('sick', masked)).toBe(false)
    expect(legendShowsKind('vacation', masked)).toBe(true)
    const full = presentKinds({ 1: { '2026-11-17': 'maternity' }, 2: {} })
    expect(legendShowsKind('maternity', full)).toBe(true)
    expect(legendShowsKind('absent', full)).toBe(false)
    expect(presentKinds(null).size).toBe(0)
  })
})

describe('the days an absence over a range lands on', () => {
  it('skips weekends, holidays, days off, „abwesend“ and a full Elternzeit', () => {
    const calendar = {
      holidays: { state: 'BW' as const, assumptionDay: true },
      freeDays: { 1: ['2027-02-05'] },
      days: { 1: { '2027-02-01': 'parental_leave' as const, '2027-02-02': 'absent' as const, '2027-02-03': 'vacation' as const } },
    }
    // Monday 01.02. to Monday 08.02.2027.
    expect(absenceDates(calendar, 1, '2027-02-01', '2027-02-08')).toEqual(['2027-02-03', '2027-02-04', '2027-02-08'])
    expect(absenceDates(null, 1, '2027-02-01', '2027-02-02')).toEqual(['2027-02-01', '2027-02-02'])
  })
})
