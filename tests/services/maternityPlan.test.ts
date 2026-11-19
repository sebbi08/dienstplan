import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { entries, maternityCases, warningAcks } from '../../server/db/schema'
import { getYearCalendar } from '../../server/services/calendar'
import { createClosure } from '../../server/services/closures'
import { applyToCells, deleteEntry } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import {
  bookMaternity, createMaternityCase, deleteMaternityCase, getEmployeeMaternity, maternityReminders, updateMaternityCase,
  type MaternityScope,
} from '../../server/services/maternity'
import { getMonthPlan } from '../../server/services/plan'
import { loadEmployee, loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { setRetentionSettings } from '../../server/services/retentionSettings'
import { getTimeMonth } from '../../server/services/timeTracking'
import { acknowledgeWarnings } from '../../server/services/warningAcks'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import { dateRange } from '../../shared/domain/dates'
import { maskPrivateEntry } from '../../shared/domain/maternity'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import { isWorkday } from '../../shared/domain/targets'
import type { DomainEntry } from '../../shared/domain/types'
import type { MaternityCaseInput, SessionUser } from '../../shared/types/api'
import { ServiceError } from '../../server/lib/errors'
import { addEmployee, addUser, codeId, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-11-19'

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let leaId: number
let anna: number
let ben: number
let benUser: SessionUser
let tablet: SessionUser
let scope: MaternityScope

/** Expected on Monday 16.11.2026: protected 05.10.2026–11.01.2027. */
const input = (values: Partial<MaternityCaseInput> = {}): MaternityCaseInput => ({
  notifiedOn: '2026-05-04', expectedBirth: '2026-11-16', actualBirth: null, extendedAfter: false, breastfeedingUntil: null,
  authorityNotifiedOn: null, riskAssessmentOn: null, employmentBan: 'none', banFrom: null, banTo: null, banNote: '', endedOn: null,
  ...values,
})
const create = (values: Partial<MaternityCaseInput> = {}) => createMaternityCase(db, leitung, scope, anna, input(values), TODAY)
const update = (id: number, values: Partial<MaternityCaseInput>, actor = leitung) =>
  updateMaternityCase(db, actor, scope, id, input(values), TODAY)
const without = (user: SessionUser, ...keys: string[]): SessionUser =>
  ({ ...user, permissions: new Set([...user.permissions].filter(key => !keys.includes(key))) }) as SessionUser

function addEntry(employeeId: number, date: string, values: Partial<typeof entries.$inferInsert>) {
  db.insert(entries).values({ employeeId, date, kind: 'special', updatedAt: '2026-11-01T00:00:00.000Z', ...values }).run()
}
const shiftOn = (employeeId: number, date: string, start = 480, end = 840) => addEntry(employeeId, date, { kind: 'special', start, end })
const codeOn = (employeeId: number, date: string, key: string) => addEntry(employeeId, date, { kind: 'code', absenceCodeId: codeId(db, key) })
const daysWith = (key: string, employeeId = anna) => loadEntries(db, { employeeId, codeKey: key }).map(entry => entry.date)
const workdays = (from: string, to: string) => dateRange(from, to).filter(date => isWorkday(loadEmployee(db, anna)!.info, date))
/** Removes Anna's entries of these days (she works there instead). */
const clearDays = (...dates: string[]) => {
  for (const date of dates) db.delete(entries).where(and(eq(entries.employeeId, anna), eq(entries.date, date))).run()
}
const hints = (viewer: SessionUser, year: number, month: number) => getMonthPlan(db, viewer, 1, year, month, TODAY).admin!.warnings
  .flatMap(warning => (warning.type === 'maternity' ? [`${warning.date} ${warning.rule}`] : warning.type === 'work_limit' ? [`${warning.date} work_limit`] : []))
const SECRETS = /maternity|employment_ban|Mutterschutz|Beschäftigungsverbot/

beforeEach(() => {
  db = createTestDb()
  leaId = addEmployee(db, 'Lea Leitung')
  leitung = addUser(db, 'leitung', 'admin', leaId)
  traeger = addUser(db, 'traeger', 'provider')
  anna = addEmployee(db, 'Anna Muster')
  ben = addEmployee(db, 'Ben Beispiel')
  benUser = addUser(db, 'ben', 'observer', ben)
  tablet = addUser(db, 'tablet', 'terminal')
  scope = { facilityId: 1, ownEmployeeId: leaId }
})

describe('the codes are hidden from everybody without the right, and always at the tablet (H1)', () => {
  it('the draft plan shows plan editors without the right „abwesend“ without key or id, and not the codes to enter', () => {
    bookMaternity(db, leitung, scope, create(), 'protection', false)
    const editor = without(leitung, 'employees.sickness')
    const plan = getMonthPlan(db, editor, 1, 2026, 11, TODAY)
    expect(JSON.stringify(plan)).not.toMatch(SECRETS)
    expect(plan.entries.find(entry => entry.employeeId === anna && entry.date === '2026-11-17'))
      .toMatchObject({ kind: 'code', codeKey: null, codeId: null, label: 'abwesend', shortLabel: null, color: 'gray', creditMode: 'daily_target' })
    expect(plan.codes.map(code => code.key)).not.toContain('maternity')
    // The hours are those of the real entries: neutral.
    expect(plan.admin!.balances).toEqual(getMonthPlan(db, leitung, 1, 2026, 11, TODAY).admin!.balances)
    // The Leitung sees them.
    expect(JSON.stringify(getMonthPlan(db, leitung, 1, 2026, 11, TODAY))).toContain('Mutterschutz')
  })

  it('the released plan and its changes show staff and the tablet „abwesend“', () => {
    bookMaternity(db, leitung, scope, create(), 'protection', false)
    releaseMonth(db, leitung, 1, 2026, 11)
    // Changed after the release and released again: the change reads „abwesend“ → the duty.
    clearDays('2026-11-17')
    shiftOn(anna, '2026-11-17')
    releaseMonth(db, leitung, 1, 2026, 11)
    for (const viewer of [benUser, tablet]) {
      const plan = getMonthPlan(db, viewer, 1, 2026, 11, TODAY)
      expect(JSON.stringify(plan)).not.toMatch(SECRETS)
      expect(plan.changes[`${anna}|2026-11-17`]?.[0]?.before).toBe('abwesend')
      expect(plan.entries.find(entry => entry.employeeId === anna && entry.date === '2026-11-18')?.label).toBe('abwesend')
    }
    expect(getMonthPlan(db, leitung, 1, 2026, 11, TODAY).changes[`${anna}|2026-11-17`]?.[0]?.before).toBe('Mutterschutz')
  })

  it('the year calendar and the time sheet show „abwesend“ and do not offer the codes', () => {
    bookMaternity(db, leitung, scope, create(), 'protection', false)
    const calendar = getYearCalendar(db, 1, 2026, { showsProtected: false })
    expect(calendar.days[anna]!['2026-11-17']).toBe('absent')
    expect(JSON.stringify(calendar)).not.toMatch(SECRETS)
    expect(getYearCalendar(db, 1, 2026).days[anna]!['2026-11-17']).toBe('maternity')
    const sheet = getTimeMonth(db, 1, anna, 2026, 11, TODAY, 600, false)
    expect(JSON.stringify(sheet)).not.toMatch(SECRETS)
    expect(sheet.days.find(day => day.date === '2026-11-17')!.plan).toBe('abwesend')
    expect(getTimeMonth(db, 1, anna, 2026, 11, TODAY, 600).days.find(day => day.date === '2026-11-17')!.plan).toBe('Mutterschutz')
  })

  it('the day overview counts „abwesend“ as absent', () => {
    const masked = maskPrivateEntry({
      employeeId: anna, date: '2026-11-17', kind: 'code', codeKey: 'maternity', codeId: 5, label: 'Mutterschutz', shortLabel: null,
      color: 'gray', creditMode: 'daily_target', start: null, end: null, breakStart: null, breakEnd: null, countsAsStaff: true, note: null,
    } as DomainEntry & { codeId: number; label: string; shortLabel: string | null; color: string; note: string | null })
    expect(buildDayOverview([{ employeeId: anna, entries: [masked] }], false).rows[0]!.states.every(state => state === 'absent')).toBe(true)
  })

  it('plan editors without the right cannot book, change or remove the codes', () => {
    bookMaternity(db, leitung, scope, create(), 'protection', false)
    const editor = without(leitung, 'employees.sickness')
    const cell = { employeeId: anna, date: '2026-11-17' }
    expect(errorCode(() => applyToCells(db, editor, 1, [cell], 'replace', { kind: 'special', start: 480, end: 720 }))).toBe('protected_cell')
    expect(errorCode(() => applyToCells(db, editor, 1, [cell], 'clear', null))).toBe('protected_cell')
    expect(errorCode(() => applyToCells(db, editor, 1, [{ employeeId: ben, date: '2026-11-17' }], 'replace', { kind: 'code', codeId: codeId(db, 'maternity') })))
      .toBe('protected_cell')
    const id = loadEntries(db, { employeeId: anna, from: '2026-11-17', to: '2026-11-17' })[0]!.id
    expect(errorCode(() => deleteEntry(db, editor, 1, id))).toBe('protected_cell')
    // Other cells as before; the Leitung may.
    applyToCells(db, editor, 1, [{ employeeId: ben, date: '2026-11-17' }], 'replace', { kind: 'special', start: 480, end: 720 })
    deleteEntry(db, leitung, 1, id)
  })
})

describe('the acknowledgements of the hints (M1)', () => {
  it('reach only viewers of the case, need the right, and go with the case', () => {
    const id = create({ notifiedOn: '2026-11-02', expectedBirth: '2027-04-01' })
    shiftOn(anna, '2026-11-18', 420, 1020)
    const key = `maternity|2026-11-18|${anna}|hours`
    acknowledgeWarnings(db, 1, leitung, [{ key, signature: '600/510' }])
    const editor = without(leitung, 'employees.sickness')
    expect(getMonthPlan(db, editor, 1, 2026, 11, TODAY).admin!.warningAcks.map(ack => ack.key)).toEqual([])
    expect(getMonthPlan(db, leitung, 1, 2026, 11, TODAY).admin!.warningAcks.map(ack => ack.key)).toEqual([key])
    expect(errorCode(() => acknowledgeWarnings(db, 1, editor, [{ key, signature: '600/510' }]))).toBe('forbidden')
    deleteMaternityCase(db, leitung, scope, id, false)
    expect(db.select().from(warningAcks).all()).toEqual([])
  })
})

describe('the period after the birth: no work at all (H2)', () => {
  it('an early birth turns duties she chose to work into hints, reported and replaceable, though the days stay the same', () => {
    const id = create()
    bookMaternity(db, leitung, scope, id, 'protection', false)
    const worked = workdays('2026-11-09', '2026-11-13')
    clearDays(...worked)
    for (const date of worked) shiftOn(anna, date)
    expect(hints(leitung, 2026, 11)).toEqual([])
    // Born on 02.11.: the same days are protected, but 09.–13.11. now lie after the birth.
    const result = update(id, { actualBirth: '2026-11-02' }).protection!
    expect(result).toMatchObject({ booked: 0, removed: 0, protectedDuties: 5 })
    expect(hints(leitung, 2026, 11)).toEqual(worked.map(date => `${date} protected`))
    expect(bookMaternity(db, leitung, scope, id, 'protection', true, { afterBirthOnly: true })).toMatchObject({ booked: 5 })
    expect(hints(leitung, 2026, 11)).toEqual([])
    expect(daysWith('maternity')).toEqual(workdays('2026-10-05', '2027-01-11'))
  })

  it('a late birth with a duty planned on a new day after it: reported, with a hint', () => {
    const id = create()
    bookMaternity(db, leitung, scope, id, 'protection', false)
    shiftOn(anna, '2027-01-12')
    expect(update(id, { actualBirth: '2026-11-18' }).protection).toMatchObject({ booked: 1, protectedDuties: 1 })
    expect(hints(leitung, 2027, 1)).toEqual(['2027-01-12 protected'])
  })

  it('a duty on a day of a full ban is a hint', () => {
    create({ notifiedOn: '2026-11-02', expectedBirth: '2027-04-01', employmentBan: 'full', banFrom: '2026-11-02', banTo: '2026-11-30' })
    shiftOn(anna, '2026-11-18')
    expect(hints(leitung, 2026, 11)).toEqual(['2026-11-18 ban'])
  })
})

describe('the end of a case and deleting it (M2)', () => {
  it('„Beendet am“ removes the booked days after it', () => {
    const id = create({ notifiedOn: '2026-10-01', expectedBirth: '2027-01-25' })
    bookMaternity(db, leitung, scope, id, 'protection', false)
    const result = update(id, { notifiedOn: '2026-10-01', expectedBirth: '2027-01-25', endedOn: '2026-12-31' }).protection!
    expect(result.removed).toBe(workdays('2027-01-01', '2027-03-22').length)
    expect(daysWith('maternity')).toEqual(workdays('2026-12-14', '2026-12-31'))
  })

  it('deleting removes the booked days only when asked (and with plan.edit)', () => {
    const id = create()
    bookMaternity(db, leitung, scope, id, 'protection', false)
    expect(errorCode(() => deleteMaternityCase(db, without(leitung, 'plan.edit'), scope, id, true))).toBe('forbidden')
    expect(deleteMaternityCase(db, leitung, scope, id, true).removed).toBe(workdays('2026-10-05', '2027-01-11').length)
    expect(daysWith('maternity')).toEqual([])
    const kept = create()
    bookMaternity(db, leitung, scope, kept, 'protection', false)
    expect(deleteMaternityCase(db, leitung, scope, kept, false).removed).toBe(0)
    expect(daysWith('maternity')).toHaveLength(workdays('2026-10-05', '2027-01-11').length)
  })

  it('a miscarriage from the 13th week books its graded period, unless she declines it (§ 3 Abs. 5)', () => {
    const facts = { notifiedOn: '2026-09-01', expectedBirth: '2027-03-01', miscarriageOn: '2026-11-10', miscarriageWeek: 18 }
    const id = create(facts)
    bookMaternity(db, leitung, scope, id, 'protection', false)
    expect(daysWith('maternity')).toEqual(workdays('2026-11-10', '2026-12-22'))
    expect(update(id, { ...facts, miscarriageWaived: true }).protection).toMatchObject({ removed: workdays('2026-11-10', '2026-12-22').length })
    expect(daysWith('maternity')).toEqual([])
    expect(errorCode(() => create({ miscarriageOn: '2026-11-10', miscarriageWeek: null }))).toBe('maternity_miscarriage_invalid')
  })
})

describe('leave in the period (M3, § 24 MuSchG)', () => {
  it('is given back after asking, and no longer counts as taken', () => {
    const id = create()
    codeOn(anna, '2026-10-06', 'vacation')
    codeOn(anna, '2026-10-07', 'vacation')
    const before = getLeaveAccount(db, anna, 2026, TODAY).account
    expect(before.taken + before.planned).toBe(2)
    let details: Record<string, unknown> | undefined
    try {
      bookMaternity(db, leitung, scope, id, 'protection', false)
    }
    catch (error) {
      details = (error as ServiceError).details
    }
    expect(details).toEqual({ days: 0, entries: false, leaveDays: 2 })
    expect(bookMaternity(db, leitung, scope, id, 'protection', true)).toMatchObject({ returnedLeave: 2 })
    expect(daysWith('vacation')).toEqual([])
    const after = getLeaveAccount(db, anna, 2026, TODAY).account
    expect(after.taken + after.planned).toBe(0)
  })
})

describe('retention „Mutterschutz-Unterlagen“ (M4)', () => {
  it('lists a case 2 years after it ended, also for someone still employed, and deletes only the due cases', () => {
    create({ notifiedOn: '2023-01-10', expectedBirth: '2023-07-01', authorityNotifiedOn: '2023-01-10', riskAssessmentOn: '2023-01-10' })
    create({ notifiedOn: '2026-05-04' })
    const items = retentionOverview(db, TODAY).filter(item => item.category === 'maternity')
    expect(items).toEqual([expect.objectContaining({
      key: `employee:${anna}:maternity`, deletableFrom: '2025-08-26', due: true, maternity: { endedOn: '2023-08-26', employed: true },
    })])
    expect(RETENTION_DEFAULTS.maternityYears).toBe(2)
    deleteRetentionItem(db, traeger, `employee:${anna}:maternity`, TODAY)
    expect(db.select({ notifiedOn: maternityCases.notifiedOn }).from(maternityCases).all()).toEqual([{ notifiedOn: '2026-05-04' }])
  })

  it('follows the facility\'s years', () => {
    create({ notifiedOn: '2023-01-10', expectedBirth: '2023-07-01' })
    setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, maternityYears: 5 })
    expect(retentionOverview(db, TODAY).find(item => item.category === 'maternity')).toMatchObject({ deletableFrom: '2028-08-26', due: false })
  })
})

describe('a change saved without plan.edit (L3)', () => {
  it('says the plan must still be adjusted, reminds the plan editors, and booking catches up', () => {
    const id = create({ authorityNotifiedOn: '2026-05-04', riskAssessmentOn: '2026-05-04' })
    bookMaternity(db, leitung, scope, id, 'protection', false)
    const reader = without(leitung, 'plan.edit')
    // A week earlier: 28.09.2026–04.01.2027.
    const facts = { expectedBirth: '2026-11-09', authorityNotifiedOn: '2026-05-04', riskAssessmentOn: '2026-05-04' }
    expect(update(id, facts, reader)).toEqual({ id, protection: null, ban: null, planOutdated: true })
    expect(getEmployeeMaternity(db, leitung, scope, anna).cases[0]!.planOutdated).toBe(true)
    const viewer = (user: SessionUser) => ({ facilityId: 1, permissions: user.permissions, onTablet: false, employeeId: user.employeeId })
    expect(maternityReminders(db, viewer(leitung), TODAY).map(item => item.maternity!.task)).toContain('planSync')
    expect(maternityReminders(db, viewer(reader), TODAY).map(item => item.maternity!.task)).not.toContain('planSync')
    expect(bookMaternity(db, leitung, scope, id, 'protection', false))
      .toMatchObject({ booked: workdays('2026-09-28', '2026-10-04').length, removed: workdays('2027-01-05', '2027-01-11').length })
    expect(daysWith('maternity')).toEqual(workdays('2026-09-28', '2027-01-04'))
    expect(getEmployeeMaternity(db, leitung, scope, anna).cases[0]!.planOutdated).toBe(false)
    expect(maternityReminders(db, viewer(leitung), TODAY).map(item => item.maternity!.task)).not.toContain('planSync')
  })
})

describe('re-review fixes (round 2)', () => {
  it('a closure leaves the protected days as they are, for the Leitung and for a closure manager without the right (R2)', () => {
    bookMaternity(db, leitung, scope, create(), 'protection', false)
    const booked = daysWith('maternity')
    // Summer closure as leave over part of the period: no leave is used there, Mutterschutz stays.
    createClosure(db, leitung, 1, { startDate: '2026-10-19', endDate: '2026-10-30', label: 'Herbst', mode: 'vacation' })
    expect(daysWith('maternity')).toEqual(booked)
    expect(daysWith('vacation')).toEqual([])
    expect(daysWith('vacation', ben)).toEqual(workdays('2026-10-19', '2026-10-30'))
    // Without employees.sickness: no 403, nothing told, the days skipped.
    const manager = without(leitung, 'employees.sickness')
    expect(errorCode(() => createClosure(db, manager, 1, { startDate: '2026-11-02', endDate: '2026-11-06', label: 'Brücke', mode: 'closure_day' })))
      .toBeNull()
    expect(daysWith('closure_day')).toEqual([])
    expect(daysWith('maternity')).toEqual(booked)
  })

  it('takes a miscarriage only up to the 23rd week: from the 24th a stillbirth is a birth (R3)', () => {
    expect(errorCode(() => create({ notifiedOn: '2026-05-04', miscarriageOn: '2026-11-10', miscarriageWeek: 24 }))).toBe('maternity_miscarriage_invalid')
    expect(errorCode(() => create({ notifiedOn: '2026-05-04', miscarriageOn: '2026-11-10', miscarriageWeek: 23 }))).toBeNull()
  })

  it('refuses deleting a case that booked the plan without plan.edit (R5)', () => {
    const id = create()
    bookMaternity(db, leitung, scope, id, 'protection', false)
    expect(errorCode(() => deleteMaternityCase(db, without(leitung, 'plan.edit'), scope, id, false))).toBe('maternity_delete_booked')
    // Not booked: deleting needs only the right to the case.
    const other = create({ notifiedOn: '2025-01-10', expectedBirth: '2025-07-01' })
    expect(deleteMaternityCase(db, without(leitung, 'plan.edit'), scope, other, false)).toEqual({ removed: 0 })
  })
})
