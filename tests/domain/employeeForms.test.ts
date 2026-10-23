import { describe, expect, it } from 'vitest'
import {
  NO_QUALIFICATION, masterFieldsOf, masterUpdate, qualificationFieldsOf, qualificationUpdate, reloadedFields,
} from '../../app/utils/employeeForms'

const saved = {
  name: 'Anna', shortName: 'AN', leftOn: null, groupId: 3, birthday: '04-09', qualification: 'fachkraft' as const, staffingShare: 80,
}

describe('employee page forms', () => {
  it('fills the two tabs from the saved employee', () => {
    expect(masterFieldsOf(saved)).toEqual({ name: 'Anna', shortName: 'AN', leftOn: '', groupId: 3, birthdayDay: 9, birthdayMonth: 4 })
    expect(qualificationFieldsOf(saved)).toEqual({ qualification: 'fachkraft', staffingShare: '80' })
    expect(qualificationFieldsOf({ ...saved, qualification: null, staffingShare: null })).toEqual({ qualification: NO_QUALIFICATION, staffingShare: '' })
  })

  it('„Stammdaten“ sends only its own fields, never the qualification', () => {
    const fields = { ...masterFieldsOf(saved), leftOn: '2026-10-31', groupId: 0 }
    expect(masterUpdate(fields, true)).toEqual({
      body: { name: 'Anna', shortName: 'AN', leftOn: '2026-10-31', birthday: '04-09', groupId: null },
    })
    expect(masterUpdate({ ...fields, birthdayMonth: 0 }, true)).toEqual({ error: 'employee_birthday_invalid' })
    expect(masterUpdate(masterFieldsOf(saved), false)).toEqual({ body: { name: 'Anna', shortName: 'AN', leftOn: null, birthday: '04-09' } })
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
})
