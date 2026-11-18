import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { errorMessage, errorTextOf } from '../../app/utils/errors'

const failed = (code: string, details?: Record<string, unknown>) => ({ data: { data: { code, details } } })

describe('the text of a failed API call', () => {
  it('names the cell of an overlap: employee, weekday and day', () => {
    // 2026-12-03 is a Thursday.
    expect(errorMessage(failed('entries_overlap', { employeeId: 3, date: '2026-12-03', name: 'Anna' })))
      .toBe('Anna, Do 03.12.: überschneidet sich mit einem vorhandenen Dienst – erst „Leeren“ oder den vorhandenen Eintrag ändern.')
  })
  it('falls back to the general overlap text without the cell (single-entry edit)', () => {
    expect(errorMessage(failed('entries_overlap'))).toBe(de.errors.entries_overlap)
    expect(errorMessage(failed('entries_overlap', { employeeId: 3 }))).toBe(de.errors.entries_overlap)
  })
  it('names the cell of a whole Büro/VZ day on a day off', () => {
    // 2026-10-10 is a Saturday.
    expect(errorMessage(failed('full_day_needs_target', { employeeId: 3, date: '2026-10-10', name: 'Anna' })))
      .toBe('Anna, Sa 10.10.: An einem freien Tag bitte Büro bzw. VZ mit Uhrzeit eintragen.')
    expect(errorMessage(failed('full_day_needs_target'))).toBe('An einem freien Tag bitte Büro bzw. VZ mit Uhrzeit eintragen.')
    expect(errorTextOf('full_day_needs_target_cell')).toBe(de.errors.generic)
  })
  it('keeps the plain texts and the generic one', () => {
    expect(errorMessage(failed('login_invalid'))).toBe(de.errors.login_invalid)
    expect(errorMessage(failed('no_such_code'))).toBe(de.errors.generic)
    expect(errorMessage(null)).toBe(de.errors.generic)
  })
  it('never hands out a text function as a text', () => {
    expect(errorTextOf('entries_overlap_cell')).toBe(de.errors.generic)
    expect(errorTextOf('entries_overlap')).toBe(de.errors.entries_overlap)
    expect(errorTextOf(undefined)).toBe(de.errors.generic)
  })
})
