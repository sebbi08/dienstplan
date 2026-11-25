import { describe, expect, it } from 'vitest'
import {
  addMonths, applicantDeletableFrom, applicantLastActivity, checkApplicant, checkApplicantDays, checkInfoVisit,
  infoVisitDeletableFrom, VisitError,
} from '../../shared/domain/visits'

const TODAY = '2026-11-25'
const codeOf = (run: () => unknown): string | null => {
  try {
    run()
    return null
  }
  catch (error) {
    return error instanceof VisitError ? error.code : String(error)
  }
}

const info = {
  visitDate: '2026-11-20', visitStart: 600, familyName: '  Familie Kurz ', phone: '0171 1234567', email: 'kurz@example.de',
  childFirstName: 'Lena', childLastName: 'Kurz', childBirthDate: '2024-05-02', desiredStart: '2027-09-01',
  guidedByEmployeeId: null, guidedByName: 'Frau Berg', notes: 'Interesse an der Krippe',
}

describe('info visits', () => {
  it('trims the texts and keeps the free-text guide only without an employee', () => {
    expect(checkInfoVisit(info, TODAY)).toEqual({ ...info, familyName: 'Familie Kurz' })
    expect(checkInfoVisit({ ...info, guidedByEmployeeId: 3 }, TODAY).guidedByName).toBe('')
  })

  it('accepts empty optional fields', () => {
    const minimal = checkInfoVisit({ visitDate: '2026-12-01', familyName: 'Berg', phone: '', email: '', childFirstName: '', childLastName: '' }, TODAY)
    expect(minimal).toMatchObject({ visitStart: null, childBirthDate: null, desiredStart: null, guidedByEmployeeId: null, notes: '', email: '' })
  })

  it.each([
    ['no visit date', { ...info, visitDate: '' }, 'visit_date_invalid'],
    ['an impossible date', { ...info, visitDate: '2026-02-30' }, 'visit_date_invalid'],
    ['a time beyond the day', { ...info, visitStart: 1440 }, 'visit_time_invalid'],
    ['no family name', { ...info, familyName: '   ' }, 'visit_name_required'],
    ['an invalid e-mail', { ...info, email: 'kurz(at)example' }, 'email_invalid'],
    ['a birth date in the future', { ...info, childBirthDate: '2026-12-01' }, 'birth_date_in_future'],
    ['a broken desired start', { ...info, desiredStart: '2027-13-01' }, 'desired_start_invalid'],
    ['too long notes', { ...info, notes: 'x'.repeat(2001) }, 'notes_too_long'],
    ['a too long name', { ...info, familyName: 'x'.repeat(121) }, 'visit_text_too_long'],
  ])('refuses %s', (_name, input, code) => {
    expect(codeOf(() => checkInfoVisit(input, TODAY))).toBe(code)
  })
})

describe('applicants', () => {
  const applicant = {
    name: 'Mara Lind', phone: '', email: 'mara@example.de', kind: 'hospitation', notes: 'offen, freundlich',
    mentorEmployeeId: 4, days: [{ date: '2026-12-03', from: 480, to: 720 }, { date: '2026-12-02', from: null, to: null }],
  }

  it('sorts the days by date', () => {
    expect(checkApplicant(applicant).days.map(day => day.date)).toEqual(['2026-12-02', '2026-12-03'])
  })

  it.each([
    ['no name', { ...applicant, name: '' }, 'visit_name_required'],
    ['an unknown kind', { ...applicant, kind: 'ferienjob' }, 'invalid_input'],
    ['an invalid e-mail', { ...applicant, email: 'mara@' }, 'email_invalid'],
  ])('refuses %s', (_name, input, code) => {
    expect(codeOf(() => checkApplicant(input))).toBe(code)
  })

  it.each([
    ['a day twice', [{ date: '2026-12-02' }, { date: '2026-12-02' }], 'visit_day_duplicate'],
    ['an end before the start', [{ date: '2026-12-02', from: 600, to: 540 }], 'visit_day_times_invalid'],
    ['an end equal to the start', [{ date: '2026-12-02', from: 600, to: 600 }], 'visit_day_times_invalid'],
    ['an impossible day', [{ date: '2026-02-30' }], 'visit_day_invalid'],
    ['more than 30 days', Array.from({ length: 31 }, (_, index) => ({ date: addMonths('2026-01-01', index) })), 'visit_days_too_many'],
  ])('refuses %s', (_name, days, code) => {
    expect(codeOf(() => checkApplicantDays(days))).toBe(code)
  })
})

describe('retention dates', () => {
  it('adds calendar months and keeps the day within the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29')
    expect(addMonths('2026-11-25', 12)).toBe('2027-11-25')
    expect(addMonths('2026-05-15', 60)).toBe('2031-05-15')
  })

  it('counts info visits from the visit day and declined applicants from the refusal', () => {
    expect(infoVisitDeletableFrom('2026-03-10', 12)).toBe('2027-03-10')
    expect(applicantDeletableFrom('2026-03-10', 6)).toBe('2026-09-10')
  })

  it('takes the later of the last change and the last day as the last activity', () => {
    expect(applicantLastActivity('2026-03-01T10:00:00.000Z', ['2026-02-01', '2026-04-02'])).toBe('2026-04-02')
    expect(applicantLastActivity('2026-05-01T10:00:00.000Z', ['2026-04-02'])).toBe('2026-05-01')
    expect(applicantLastActivity('2026-05-01T10:00:00.000Z', [])).toBe('2026-05-01')
  })
})
