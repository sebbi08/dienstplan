import { describe, expect, it } from 'vitest'
import { checkHeader, filterFromQuery, filterGroupId, headerBody, headerForm } from '../../app/utils/teamMeetings'

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
  const meeting = { date: '2026-10-21', start: 13 * 60 + 5, groupId: 4, participants: 'Anna', recorder: 'Ben' }

  it('fills the fields from the meeting and sends them back unchanged', () => {
    const form = headerForm(meeting)
    expect(form).toEqual({ date: '2026-10-21', start: '13:05', group: '4', participants: 'Anna', recorder: 'Ben' })
    expect(headerBody(form)).toEqual({ ...meeting, participantIds: [] })
  })

  it('starts a new meeting for the whole facility without time', () => {
    const form = headerForm(null, '2026-10-26')
    expect(form).toEqual({ date: '2026-10-26', start: '', group: 'facility', participants: '', recorder: '' })
    expect(headerBody(form)).toMatchObject({ start: null, groupId: null })
  })

  it('refuses an invalid date or time before saving', () => {
    expect(checkHeader(headerForm(meeting))).toBeNull()
    expect(checkHeader({ ...headerForm(meeting), date: '' })).toBe('Bitte ein gültiges Datum angeben.')
    expect(checkHeader({ ...headerForm(meeting), start: '25:00' })).toMatch(/Ungültige Uhrzeit/)
    expect(checkHeader({ ...headerForm(meeting), start: '24:00' })).toMatch(/Ungültige Uhrzeit/)
    expect(headerBody({ ...headerForm(meeting), start: 'abc' }).start).toBe(-1)
  })
})
