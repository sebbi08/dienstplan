import { describe, expect, it } from 'vitest'
import { legendShowsKind, presentKinds } from '../../app/utils/calendarKinds'

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
