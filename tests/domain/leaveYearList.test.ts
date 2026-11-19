import { describe, expect, it } from 'vitest'
import { decodeLeaveFilter, encodeLeaveFilter, leaveAccountLine, rangeOriginText } from '../../app/utils/leaveYearList'

describe('Alle Anträge und Urlaube (texts and print filter)', () => {
  it('puts the filters into one path part for the print view and reads them back', () => {
    expect(encodeLeaveFilter({})).toBe('alle-alle-alle')
    expect(encodeLeaveFilter({ employeeId: 3, kind: 'overtime_off', status: 'direct' })).toBe('3-overtime_off-direct')
    expect(decodeLeaveFilter('3-overtime_off-direct')).toEqual({ employeeId: 3, kind: 'overtime_off', status: 'direct' })
    expect(decodeLeaveFilter('alle-special_leave-alle')).toEqual({ employeeId: null, kind: 'special_leave', status: null })
    // Anything unknown counts as „alle“.
    expect(decodeLeaveFilter('x-holiday-maybe')).toEqual({ employeeId: null, kind: null, status: null })
    expect(decodeLeaveFilter('')).toEqual({ employeeId: null, kind: null, status: null })
  })

  it('names where a leave period comes from', () => {
    const base = { kind: 'vacation' as const, from: '2026-11-02', to: '2026-11-04', days: 3, requestId: null, decidedAt: null, closureLabel: null }
    expect(rangeOriginText({ ...base, origin: 'request', requestId: 4, decidedAt: '2026-10-08T09:00:00.000Z' })).toBe('Antrag genehmigt am 08.10.2026')
    expect(rangeOriginText({ ...base, origin: 'direct' })).toBe('direkt eingetragen')
    expect(rangeOriginText({ ...base, origin: 'closure', closureLabel: 'Weihnachten' })).toBe('Schließzeit Weihnachten')
  })

  it('sums up the leave account in one line', () => {
    expect(leaveAccountLine({ entitlement: 30, carriedOver: 2, taken: 2, planned: 7.5, available: 22.5 }, true))
      .toBe('Anspruch 30 + Übertrag 2 · genommen 2 · verplant 7,5 · frei verfügbar 22,5')
    expect(leaveAccountLine({ entitlement: 30, carriedOver: 0, taken: 0, planned: 0, available: 30 }, true))
      .toBe('Anspruch 30 · genommen 0 · verplant 0 · frei verfügbar 30')
    expect(leaveAccountLine({ entitlement: 0, carriedOver: 0, taken: 3, planned: 0, available: -3 }, false))
      .toBe('Kein Urlaubsanspruch eingetragen · genommen 3 · verplant 0')
  })
})
