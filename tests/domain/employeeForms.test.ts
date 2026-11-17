import { describe, expect, it } from 'vitest'
import {
  NO_QUALIFICATION, birthYearOnlyUpdate, masterFieldsOf, masterUpdate, qualificationFieldsOf, qualificationUpdate, reloadedFields,
} from '../../app/utils/employeeForms'

const saved = {
  name: 'Anna', shortName: 'AN', leftOn: null, groupId: 3, birthday: '04-09', qualification: 'fachkraft' as const, staffingShare: 80,
}

describe('employee page forms', () => {
  it('fills the two tabs from the saved employee', () => {
    expect(masterFieldsOf(saved)).toEqual({ name: 'Anna', shortName: 'AN', leftOn: '', groupId: 3, birthday: '09.04.' })
    expect(masterFieldsOf({ ...saved, personal: { birthYear: 1985 } as never }).birthday).toBe('09.04.1985')
    expect(masterFieldsOf({ ...saved, birthday: null }).birthday).toBe('')
    expect(qualificationFieldsOf(saved)).toEqual({ qualification: 'fachkraft', staffingShare: '80' })
    expect(qualificationFieldsOf({ ...saved, qualification: null, staffingShare: null })).toEqual({ qualification: NO_QUALIFICATION, staffingShare: '' })
  })

  it('„Stammdaten“ sends only its own fields, never the qualification', () => {
    const fields = { ...masterFieldsOf(saved), leftOn: '2026-10-31', groupId: 0 }
    const loaded = fields.birthday
    // Birthday field untouched: day, month and year stay as stored (left out of the body).
    expect(masterUpdate(fields, true, false, loaded)).toEqual({
      body: { name: 'Anna', shortName: 'AN', leftOn: '2026-10-31', groupId: null }, birthYear: undefined,
    })
    expect(masterUpdate({ ...fields, birthday: '10.04.' }, true, false, loaded)).toMatchObject({ body: { birthday: '04-10' } })
    expect(masterUpdate({ ...fields, birthday: '31.02.' }, true, false, loaded)).toEqual({ error: 'employee_birthday_invalid' })
    expect(masterUpdate({ ...fields, birthday: '' }, true, false, loaded)).toMatchObject({ body: { birthday: null } })
    // With the personnel file the year goes along (to personal.birthYear), not into the master body.
    expect(masterUpdate({ ...fields, birthday: '4.3.1985' }, true, true, loaded)).toEqual({
      body: { name: 'Anna', shortName: 'AN', leftOn: '2026-10-31', birthday: '03-04', groupId: null }, birthYear: 1985,
    })
    expect(masterUpdate({ ...fields, birthday: '4.3.1985' }, true, false, loaded)).toEqual({ error: 'employee_birthday_invalid' })
    // Deliberately removing the year (it was in the field) clears it.
    expect(masterUpdate({ ...fields, birthday: '09.04.' }, true, true, '09.04.1985')).toMatchObject({ birthYear: null })
    // Untouched with a year: nothing about the birthday is sent.
    expect(masterUpdate({ ...fields, birthday: '09.04.1985' }, true, true, '09.04.1985'))
      .toEqual({ body: { name: 'Anna', shortName: 'AN', leftOn: '2026-10-31', groupId: null }, birthYear: undefined })
    // A stored year without day and month (empty field): other Stammdaten keep it; adding day and month keeps it too.
    expect(masterUpdate({ ...fields, birthday: '', name: 'Anna B.' }, true, true, '')).toEqual({
      body: { name: 'Anna B.', shortName: 'AN', leftOn: '2026-10-31', groupId: null }, birthYear: undefined,
    })
    expect(masterUpdate({ ...fields, birthday: '4.3.' }, true, true, '')).toMatchObject({ body: { birthday: '03-04' }, birthYear: undefined })
    expect(masterUpdate(masterFieldsOf(saved), false, false, loaded))
      .toEqual({ body: { name: 'Anna', shortName: 'AN', leftOn: null }, birthYear: undefined })
  })

  it('„Qualifikation“ sends the saved name and „ausgeschieden am“, not what is typed in „Stammdaten“', () => {
    expect(qualificationUpdate({ ...saved, leftOn: '2027-01-31' }, { qualification: 'azubi_2', staffingShare: ' 40 ' })).toEqual({
      body: { name: 'Anna', shortName: 'AN', leftOn: '2027-01-31', qualification: 'azubi_2', staffingShare: 40 },
    })
    expect(qualificationUpdate(saved, { qualification: NO_QUALIFICATION, staffingShare: '' }))
      .toEqual({ body: { name: 'Anna', shortName: 'AN', leftOn: null, qualification: null, staffingShare: null } })
    expect(qualificationUpdate(saved, { qualification: 'fachkraft', staffingShare: '101' })).toEqual({ error: 'staffing_share_invalid' })
    expect(qualificationUpdate(saved, { qualification: 'fachkraft', staffingShare: '12.5' })).toEqual({ error: 'staffing_share_invalid' })
  })

  it('keeps unsaved edits of a tab when the employee is reloaded', () => {
    const before = qualificationFieldsOf(saved)
    const now = qualificationFieldsOf({ ...saved, staffingShare: 60 })
    // Nothing typed: the reloaded values.
    expect(reloadedFields({ ...before }, before, now, false)).toEqual(now)
    // A number input may hand back a number: still nothing typed.
    expect(reloadedFields({ ...before, staffingShare: 80 as unknown as string }, before, now, false)).toEqual(now)
    // Typed and not saved: stays.
    const typed = { ...before, qualification: 'azubi_1' as const }
    expect(reloadedFields(typed, before, now, false)).toEqual(typed)
    // This tab was just saved, or the first load: the loaded values.
    expect(reloadedFields(typed, before, now, true)).toEqual(now)
    expect(reloadedFields(typed, null, now, false)).toEqual(now)
  })

  it('a new employee gets the birth year with a follow-up update of the personal block only', () => {
    expect(birthYearOnlyUpdate('Anna', 'AN', 1985)).toEqual({
      name: 'Anna', shortName: 'AN', leftOn: null,
      personal: { birthYear: 1985, street: null, postalCode: null, city: null, phone: null, email: null },
    })
  })
})
