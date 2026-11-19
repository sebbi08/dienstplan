import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { specialDays, specialLeaveReasonText, specialRanges } from '../../app/utils/specialLeave'
import { checkedSpecialLeaveReason, SPECIAL_LEAVE_REASONS } from '../../shared/domain/specialLeave'
import type { LeaveEntryRange } from '../../shared/types/api'

describe('the Sonderurlaub list of a leave account', () => {
  const ranges: LeaveEntryRange[] = [
    { kind: 'vacation', from: '2026-11-02', to: '2026-11-03', days: 2 },
    { kind: 'special_leave', from: '2026-11-16', to: '2026-11-16', days: 1, reason: { key: 'move', text: 'nach Köln' } },
    { kind: 'special_leave', from: '2026-11-18', to: '2026-11-19', days: 2, reason: { key: null, text: null } },
    { kind: 'special_leave', from: '2026-11-23', to: '2026-11-23', days: 1 },
  ]
  it('takes the Sonderurlaub periods with their days and reason texts', () => {
    expect(specialRanges(ranges)).toHaveLength(3)
    expect(specialDays(ranges)).toBe(4)
    expect(specialRanges(ranges).map(specialLeaveReasonText)).toEqual(['Umzug aus dienstlichem Grund (1 Tag) – nach Köln', '', ''])
  })
})

describe('Sonderurlaub reasons (TVöD § 29)', () => {
  it('lists the common reasons with their usual days, „Sonstiges“ last', () => {
    expect(SPECIAL_LEAVE_REASONS.map(reason => de.specialLeave.reasons[reason])).toEqual([
      'Niederkunft der Ehefrau/Lebenspartnerin (1 Tag)',
      'Tod von Ehegatte/Lebenspartner, Kind oder Elternteil (2 Tage)',
      'Umzug aus dienstlichem Grund (1 Tag)',
      '25- oder 40-jähriges Arbeitsjubiläum (1 Tag)',
      'Schwere Erkrankung einer/eines Angehörigen im Haushalt (1 Tag im Jahr)',
      'Schwere Erkrankung eines Kindes unter 12 (bis 4 Tage im Jahr)',
      'Schwere Erkrankung der Betreuungsperson eines Kindes unter 8 (bis 4 Tage im Jahr)',
      'Sonstiges',
    ])
  })

  it('checks key and text: „Sonstiges“ needs a text, any reason may have one, at most 200 characters', () => {
    expect(checkedSpecialLeaveReason(null, null)).toEqual({ reason: null, text: null })
    expect(checkedSpecialLeaveReason(null, '  ')).toEqual({ reason: null, text: null })
    expect(checkedSpecialLeaveReason('move', null)).toEqual({ reason: 'move', text: null })
    expect(checkedSpecialLeaveReason('death', '  Vater ')).toEqual({ reason: 'death', text: 'Vater' })
    expect(checkedSpecialLeaveReason('other', 'Hochzeit')).toEqual({ reason: 'other', text: 'Hochzeit' })
    expect(checkedSpecialLeaveReason('other', ' ')).toEqual({ error: 'special_leave_text_required' })
    expect(checkedSpecialLeaveReason('wedding', null)).toEqual({ error: 'special_leave_reason_invalid' })
    expect(checkedSpecialLeaveReason(null, 'nur Text')).toEqual({ error: 'special_leave_reason_invalid' })
    expect(checkedSpecialLeaveReason('other', 'x'.repeat(201))).toEqual({ error: 'special_leave_text_too_long' })
    expect(checkedSpecialLeaveReason('other', 'x'.repeat(200))).toMatchObject({ reason: 'other' })
  })
})
