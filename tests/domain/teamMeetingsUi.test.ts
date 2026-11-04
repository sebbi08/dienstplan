import { describe, expect, it } from 'vitest'
import {
  checkHeader, countsAsSigner, filterFromQuery, filterGroupId, headerBody, headerForm, participantsLine, signingProgress,
  toggleParticipant,
} from '../../app/utils/teamMeetings'

describe('the group filter of the team meetings list', () => {
  it('sends no groupId for „Alle“, 0 for „Einrichtung“ and the id for a group', () => {
    expect(filterGroupId('all')).toBeUndefined()
    expect(filterGroupId('facility')).toBe(0)
    expect(filterGroupId(4)).toBe(4)
  })
  it('reads the filter from the address, anything unknown is „Alle“', () => {
    expect(filterFromQuery(undefined)).toBe('all')
    expect(filterFromQuery('facility')).toBe('facility')
    expect(filterFromQuery('4')).toBe(4)
    expect(filterFromQuery('0')).toBe('all')
    expect(filterFromQuery('x')).toBe('all')
    expect(filterFromQuery(['4'])).toBe('all')
  })
})

describe('the header of a team meeting', () => {
  const signer = (employeeId: number | null, name: string) => ({ employeeId, name, signedAt: null, signedVia: null })
  const header = { date: '2026-10-21', start: 13 * 60 + 5, groupId: 4, participants: 'Anna', recorder: 'Ben' }
  const meeting = { ...header, signers: [signer(7, 'Clara'), signer(null, 'Dora'), signer(3, 'Emil')] }

  it('fills the fields from the meeting and sends them back unchanged', () => {
    const form = headerForm(meeting)
    expect(form).toEqual({ date: '2026-10-21', start: '13:05', group: '4', participants: 'Anna', recorder: 'Ben', participantIds: [7, 3] })
    expect(headerBody(form)).toEqual({ ...header, participantIds: [7, 3] })
  })

  it('starts a new meeting for the whole facility without time and without participants', () => {
    const form = headerForm(null, '2026-10-26')
    expect(form).toEqual({ date: '2026-10-26', start: '', group: 'facility', participants: '', recorder: '', participantIds: [] })
    expect(headerBody(form)).toMatchObject({ start: null, groupId: null, participantIds: [] })
  })

  it('refuses an invalid date or time before saving', () => {
    expect(checkHeader(headerForm(meeting))).toBeNull()
    expect(checkHeader({ ...headerForm(meeting), date: '' })).toBe('Bitte ein gültiges Datum angeben.')
    expect(checkHeader({ ...headerForm(meeting), start: '25:00' })).toMatch(/Ungültige Uhrzeit/)
    expect(checkHeader({ ...headerForm(meeting), start: '24:00' })).toMatch(/Ungültige Uhrzeit/)
    expect(headerBody({ ...headerForm(meeting), start: 'abc' }).start).toBe(-1)
  })

  it('keeps the ticked participants in the order of the staff list', () => {
    const staff = [{ id: 3 }, { id: 5 }, { id: 7 }]
    expect(toggleParticipant([7], staff, 3, true)).toEqual([3, 7])
    expect(toggleParticipant([3, 7], staff, 5, true)).toEqual([3, 5, 7])
    expect(toggleParticipant([3, 5, 7], staff, 5, false)).toEqual([3, 7])
    expect(toggleParticipant([3], staff, 3, true)).toEqual([3])
    // One not in the list shown stays, after the others.
    expect(toggleParticipant([9, 7], staff, 3, true)).toEqual([3, 7, 9])
  })

  it('names the chosen participants first, then the typed ones', () => {
    expect(participantsLine(['Clara', 'Emil'], ' Frau Weber ')).toBe('Clara, Emil, Frau Weber')
    expect(participantsLine([], 'Frau Weber')).toBe('Frau Weber')
    expect(participantsLine(['Clara'], '')).toBe('Clara')
    expect(participantsLine([], '')).toBe('')
  })
})

describe('counting the signatures of a team meeting', () => {
  const at = '2026-11-04T13:20:00.000Z'
  it('counts who signed and who still can, not one deleted for good before signing', () => {
    const signers = [
      { employeeId: 1, signedAt: at },
      { employeeId: 2, signedAt: null },
      { employeeId: null, signedAt: at },
      { employeeId: null, signedAt: null },
    ]
    expect(signers.map(countsAsSigner)).toEqual([true, true, true, false])
    expect(signingProgress(signers)).toEqual({ signed: 2, total: 3 })
    expect(signingProgress([])).toEqual({ signed: 0, total: 0 })
  })
})
