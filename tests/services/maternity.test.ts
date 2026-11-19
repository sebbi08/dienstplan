import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { absenceCodes, employees, entries, maternityCases } from '../../server/db/schema'
import { categoryHasData, deleteCategories } from '../../server/services/employeeDeletion'
import { getLeaveAccount } from '../../server/services/leave'
import {
  bookMaternity, checkMaternityBan, createMaternityCase, deleteMaternityCase, getEmployeeMaternity, maternityReminders,
  updateMaternityCase, type MaternityScope,
} from '../../server/services/maternity'
import { getMonthPlan } from '../../server/services/plan'
import { loadEmployee, loadEntries } from '../../server/services/queries'
import { listReminders } from '../../server/services/reminders'
import { computeDay } from '../../shared/domain/balance'
import { dateRange } from '../../shared/domain/dates'
import type { PermissionKey } from '../../shared/domain/permissions'
import { isWorkday } from '../../shared/domain/targets'
import type { MaternityCaseInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, asChildViewer, codeId, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-11-19'

let db: Db
let leitung: SessionUser
let traeger: SessionUser
let leaId: number
let anna: number
let scope: MaternityScope

/** Expected on Monday 16.11.2026: protected 05.10.2026–11.01.2027. */
const input = (values: Partial<MaternityCaseInput> = {}): MaternityCaseInput => ({
  notifiedOn: '2026-05-04', expectedBirth: '2026-11-16', actualBirth: null, extendedAfter: false, breastfeedingUntil: null,
  authorityNotifiedOn: null, riskAssessmentOn: null, employmentBan: 'none', banFrom: null, banTo: null, banNote: '', endedOn: null,
  ...values,
})

const create = (values: Partial<MaternityCaseInput> = {}, employeeId = anna) =>
  createMaternityCase(db, leitung, scope, employeeId, input(values), TODAY)
const update = (id: number, values: Partial<MaternityCaseInput>, actor = leitung) =>
  updateMaternityCase(db, actor, scope, id, input(values), TODAY)

function addEntry(employeeId: number, date: string, values: Partial<typeof entries.$inferInsert>) {
  db.insert(entries).values({ employeeId, date, kind: 'special', updatedAt: '2026-11-01T00:00:00.000Z', ...values }).run()
}
const shiftOn = (employeeId: number, date: string, start: number, end: number, breakStart: number | null = null, breakEnd: number | null = null) =>
  addEntry(employeeId, date, { kind: 'special', start, end, breakStart, breakEnd })
const codeOn = (employeeId: number, date: string, key: string) =>
  addEntry(employeeId, date, { kind: 'code', absenceCodeId: codeId(db, key) })

/** The days with an entry of the code, in order. */
const daysWith = (key: string, employeeId = anna) => loadEntries(db, { employeeId, codeKey: key }).map(entry => entry.date)
/** Anna's working days between from and to (Monday to Friday without the facility's public holidays). */
const workdays = (from: string, to: string) => dateRange(from, to).filter(date => isWorkday(loadEmployee(db, anna)!.info, date))

beforeEach(() => {
  db = createTestDb()
  leaId = addEmployee(db, 'Lea Leitung')
  leitung = addUser(db, 'leitung', 'admin', leaId)
  traeger = addUser(db, 'traeger', 'provider')
  anna = addEmployee(db, 'Anna Muster')
  scope = { facilityId: 1, ownEmployeeId: leaId }
})

describe('the codes Mutterschutz and Beschäftigungsverbot', () => {
  it('come after „Kind krank“, whole days crediting the daily target', () => {
    const codes = db.select().from(absenceCodes).all().sort((a, b) => a.sortOrder - b.sortOrder)
    const keys = codes.map(code => code.key)
    expect(keys.slice(keys.indexOf('child_sick'), keys.indexOf('child_sick') + 3)).toEqual(['child_sick', 'maternity', 'employment_ban'])
    expect(codes.find(code => code.key === 'maternity')).toMatchObject({ label: 'Mutterschutz', creditMode: 'daily_target', requiresTimes: false })
    expect(codes.find(code => code.key === 'employment_ban'))
      .toMatchObject({ label: 'Beschäftigungsverbot', creditMode: 'daily_target', requiresTimes: false })
    expect(new Set(codes.map(code => code.sortOrder)).size).toBe(codes.length)
  })

  it('are neutral for the hours account and take nothing from the leave (§ 24 MuSchG)', () => {
    codeOn(anna, '2026-11-17', 'maternity')
    codeOn(anna, '2026-11-18', 'employment_ban')
    const info = loadEmployee(db, anna)!.info
    for (const date of ['2026-11-17', '2026-11-18']) {
      const day = computeDay(info, date, loadEntries(db, { employeeId: anna }))
      expect(day.target).toBe(468)
      expect(day.credit).toBe(day.target)
    }
    const account = getLeaveAccount(db, anna, 2026, TODAY).account
    expect(account.taken + account.planned).toBe(0)
  })
})

describe('the case and who may see it', () => {
  it('is entered and listed for Leitung and Träger, newest first', () => {
    const first = create({ notifiedOn: '2024-02-01', expectedBirth: '2024-08-01', actualBirth: '2024-07-30' })
    const second = create()
    const view = getEmployeeMaternity(db, leitung, scope, anna)
    expect(view.canBook).toBe(true)
    expect(view.cases.map(item => item.id)).toEqual([second, first])
    expect(view.cases[0]).toMatchObject({
      notifiedOn: '2026-05-04', expectedBirth: '2026-11-16', employmentBan: 'none', protectionBooked: false, createdBy: 'Lea Leitung',
    })
    expect(getEmployeeMaternity(db, traeger, { facilityId: 1, ownEmployeeId: null }, anna).cases).toHaveLength(2)
  })

  it('never about the viewer themselves (the Träger handles a Leitung\'s case), never outside the facility', () => {
    expect(errorCode(() => getEmployeeMaternity(db, leitung, scope, leaId))).toBe('maternity_own')
    expect(errorCode(() => create({}, leaId))).toBe('maternity_own')
    const leaCase = createMaternityCase(db, traeger, { facilityId: 1, ownEmployeeId: null }, leaId, input(), TODAY)
    expect(errorCode(() => update(leaCase, {}))).toBe('maternity_not_found')
    expect(errorCode(() => deleteMaternityCase(db, leitung, scope, leaCase, false))).toBe('maternity_not_found')
    expect(errorCode(() => bookMaternity(db, leitung, scope, leaCase, 'protection', false))).toBe('maternity_not_found')
    const hort = addFacility(db, 'Hort')
    const other = addEmployee(db, 'Olga', { facilityId: hort })
    expect(errorCode(() => getEmployeeMaternity(db, leitung, scope, other))).toBe('employee_not_found')
    const annaCase = create()
    expect(errorCode(() => updateMaternityCase(db, leitung, { facilityId: hort, ownEmployeeId: null }, annaCase, input(), TODAY)))
      .toBe('maternity_not_found')
  })

  it('checks the dates', () => {
    expect(errorCode(() => create({ notifiedOn: '2026-11-20' }))).toBe('maternity_date_future')
    expect(errorCode(() => create({ actualBirth: '2026-11-20', expectedBirth: '2026-11-25' }))).toBe('maternity_date_future')
    expect(errorCode(() => create({ actualBirth: '2025-11-10' }))).toBe('maternity_birth_invalid')
    expect(errorCode(() => create({ breastfeedingUntil: '2026-11-15' }))).toBe('maternity_breastfeeding_invalid')
    expect(errorCode(() => create({ employmentBan: 'full', banFrom: null }))).toBe('maternity_ban_invalid')
    expect(errorCode(() => create({ employmentBan: 'partial', banFrom: '2026-09-10', banTo: '2026-09-01' }))).toBe('maternity_ban_invalid')
    expect(errorCode(() => create({ endedOn: '2026-05-01' }))).toBe('maternity_ended_invalid')
    expect(errorCode(() => create({ banNote: 'x'.repeat(2001) }))).toBe('maternity_note_too_long')
    // No ban: no days of a ban are kept.
    const id = create({ employmentBan: 'none', banFrom: '2026-09-01', banTo: '2026-09-30' })
    expect(getEmployeeMaternity(db, leitung, scope, anna).cases.find(item => item.id === id)).toMatchObject({ banFrom: null, banTo: null })
  })

  it('has its own retention category „Mutterschutz-Unterlagen“ (not the immediate data)', () => {
    expect(categoryHasData(db, anna).maternity).toBe(false)
    create()
    expect(categoryHasData(db, anna)).toMatchObject({ immediate: false, maternity: true })
    db.transaction(tx => deleteCategories(tx, anna, ['maternity']))
    expect(db.select().from(maternityCases).all()).toEqual([])
  })
})

describe('„Schutzfristen eintragen“', () => {
  it('books Mutterschutz on the working days of both periods, keeping Krank, asking before replacing duties', () => {
    const id = create()
    codeOn(anna, '2026-10-07', 'sick')
    shiftOn(anna, '2026-10-08', 480, 780)
    expect(errorCode(() => bookMaternity(db, leitung, scope, id, 'protection', false))).toBe('cells_occupied')
    expect(daysWith('maternity')).toEqual([])
    const result = bookMaternity(db, leitung, scope, id, 'protection', true)
    const expected = workdays('2026-10-05', '2027-01-11').filter(date => date !== '2026-10-07')
    expect(result).toMatchObject({ booked: expected.length, removed: 0, keptAbsences: 1, returnedLeave: 0 })
    expect(daysWith('maternity')).toEqual(expected)
    expect(daysWith('sick')).toEqual(['2026-10-07'])
    expect(getEmployeeMaternity(db, leitung, scope, anna).cases[0]!.protectionBooked).toBe(true)
    // Booking again changes nothing.
    expect(bookMaternity(db, leitung, scope, id, 'protection', false)).toMatchObject({ booked: 0 })
  })

  it('needs plan.edit', () => {
    const id = create()
    const reader: SessionUser = { ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'plan.edit')) }
    expect(errorCode(() => bookMaternity(db, reader, scope, id, 'protection', false))).toBe('forbidden')
    expect(getEmployeeMaternity(db, reader, scope, anna).canBook).toBe(false)
  })

  it('books again when the dates change: new days get it, days no longer protected lose it, worked days stay', () => {
    const id = create()
    bookMaternity(db, leitung, scope, id, 'protection', false)
    // Born two days late (18.11.): the 8 weeks end on 13.01.2027.
    expect(update(id, { actualBirth: '2026-11-18' }).protection)
      .toMatchObject({ booked: 2, removed: 0, keptAbsences: 0, skippedOccupied: 0, protectedDuties: 0 })
    expect(daysWith('maternity').slice(-2)).toEqual(['2027-01-12', '2027-01-13'])
    // She chose to work on 12.10. (before the birth): the day is a duty now, booking again leaves it.
    db.delete(entries).where(eq(entries.date, '2026-10-12')).run()
    shiftOn(anna, '2026-10-12', 480, 780)
    const extended = update(id, { actualBirth: '2026-11-18', extendedAfter: true }).protection!
    expect(extended).toMatchObject({ booked: workdays('2027-01-14', '2027-02-10').length, removed: 0, skippedOccupied: 0, protectedDuties: 0 })
    expect(daysWith('maternity')).not.toContain('2026-10-12')
    expect(daysWith('maternity').at(-1)).toBe('2027-02-10')
    // Back to 8 weeks: the extra days go again (only entries of the code).
    codeOn(anna, '2027-02-01', 'vacation')
    expect(update(id, { actualBirth: '2026-11-18' }).protection).toMatchObject({ booked: 0, removed: extended.booked })
    expect(daysWith('maternity').at(-1)).toBe('2027-01-13')
    expect(daysWith('vacation')).toEqual(['2027-02-01'])
    // Unchanged periods book nothing.
    expect(update(id, { actualBirth: '2026-11-18', riskAssessmentOn: '2026-05-10' }).protection).toBeNull()
  })

  it('adds the days of the period before not taken after an early birth', () => {
    // Expected 16.11., born 02.11.: the period after runs to 11.01.2027 as well.
    const id = create({ actualBirth: '2026-11-02' })
    bookMaternity(db, leitung, scope, id, 'protection', false)
    expect(daysWith('maternity')).toEqual(workdays('2026-10-05', '2027-01-11'))
  })

  it('does not book again without having booked', () => {
    const id = create()
    expect(update(id, { actualBirth: '2026-11-18' })).toEqual({ id, protection: null, ban: null, planOutdated: false })
    expect(daysWith('maternity')).toEqual([])
  })
})

describe('„Beschäftigungsverbot eintragen“', () => {
  it('books a full ban until the protection period begins, never on its days', () => {
    const id = create({ employmentBan: 'full', banFrom: '2026-09-01', banTo: '2026-10-09' })
    expect(bookMaternity(db, leitung, scope, id, 'ban', false)).toMatchObject({ booked: workdays('2026-09-01', '2026-10-04').length })
    expect(daysWith('employment_ban')).toEqual(workdays('2026-09-01', '2026-10-04'))
    // Mutterschutz replaces a booked ban without asking.
    codeOn(anna, '2026-10-05', 'employment_ban')
    bookMaternity(db, leitung, scope, id, 'protection', false)
    expect(daysWith('maternity')[0]).toBe('2026-10-05')
    expect(daysWith('employment_ban')).not.toContain('2026-10-05')
  })

  it('without an end runs until the day before the protection period; removed when the ban is taken back', () => {
    const id = create({ employmentBan: 'full', banFrom: '2026-09-28' })
    bookMaternity(db, leitung, scope, id, 'ban', false)
    expect(daysWith('employment_ban')).toEqual(workdays('2026-09-28', '2026-10-04'))
    expect(update(id, { employmentBan: 'partial', banFrom: '2026-09-28', banNote: 'keine Spätdienste' }).ban)
      .toMatchObject({ removed: workdays('2026-09-28', '2026-10-04').length })
    expect(daysWith('employment_ban')).toEqual([])
  })

  it('needs a full ban', () => {
    const id = create({ employmentBan: 'partial', banFrom: '2026-09-01' })
    expect(errorCode(() => bookMaternity(db, leitung, scope, id, 'ban', false))).toBe('maternity_ban_period')
  })
})

describe('the reminders', () => {
  const viewerOf = (user: SessionUser, extra: Partial<{ onTablet: boolean; permissions: ReadonlySet<PermissionKey> }> = {}) => ({
    facilityId: 1, permissions: user.permissions, onTablet: false, employeeId: user.employeeId, ...extra,
  })
  const tasks = (user: SessionUser, extra = {}) =>
    maternityReminders(db, viewerOf(user, extra), TODAY).map(item => `${item.name}: ${item.maternity!.task} ${item.state}`)

  it('remind of the authority, the risk assessment and the ban check until each is done', () => {
    const id = create({ notifiedOn: '2026-11-19', expectedBirth: '2027-04-01' })
    expect(tasks(leitung)).toEqual(['Anna Muster: authority today', 'Anna Muster: riskAssessment today', 'Anna Muster: banCheck today'])
    expect(maternityReminders(db, viewerOf(leitung), TODAY)[0]).toEqual({
      kind: 'maternity', date: '2026-11-19', state: 'today', name: 'Anna Muster', childId: null, age: null, ownChild: false, canDone: false,
      time: null, meetingKind: null, count: null, maternity: { employeeId: anna, caseId: id, task: 'authority' },
    })
    update(id, { notifiedOn: '2026-11-19', expectedBirth: '2027-04-01', authorityNotifiedOn: '2026-11-19' })
    expect(tasks(leitung)).toEqual(['Anna Muster: riskAssessment today', 'Anna Muster: banCheck today'])
    update(id, { notifiedOn: '2026-11-19', expectedBirth: '2027-04-01', authorityNotifiedOn: '2026-11-19', riskAssessmentOn: '2026-11-19' })
    expect(tasks(leitung)).toEqual(['Anna Muster: banCheck today'])
    checkMaternityBan(db, scope, id, TODAY)
    expect(tasks(leitung)).toEqual([])
  })

  it('the notice to the authority is overdue from the day after the notice; a ban entered ends the check', () => {
    const id = create({ notifiedOn: '2026-11-10', expectedBirth: '2027-04-01', riskAssessmentOn: '2026-11-12' })
    expect(tasks(leitung)).toEqual(['Anna Muster: authority overdue', 'Anna Muster: banCheck today'])
    update(id, { notifiedOn: '2026-11-10', expectedBirth: '2027-04-01', riskAssessmentOn: '2026-11-12', employmentBan: 'partial', banFrom: '2026-11-12' })
    expect(tasks(leitung)).toEqual(['Anna Muster: authority overdue'])
  })

  it('keep the authority and the risk assessment until done, also after the case; never for someone who left', () => {
    create({ notifiedOn: '2025-01-10', expectedBirth: '2025-06-01' })
    expect(tasks(leitung)).toEqual(['Anna Muster: authority overdue', 'Anna Muster: riskAssessment overdue'])
    db.update(employees).set({ leftOn: '2026-10-31' }).where(eq(employees.id, anna)).run()
    expect(tasks(leitung)).toEqual([])
  })

  it('mark the risk assessment overdue 14 days after the notice', () => {
    create({ notifiedOn: '2026-11-05', expectedBirth: '2027-04-01', authorityNotifiedOn: '2026-11-05' })
    expect(tasks(leitung)).toEqual(['Anna Muster: riskAssessment today', 'Anna Muster: banCheck today'])
    db.update(maternityCases).set({ notifiedOn: '2026-11-04' }).run()
    expect(tasks(leitung)).toEqual(['Anna Muster: riskAssessment overdue', 'Anna Muster: banCheck today'])
  })

  it('for employees.sickness, never at the tablet, never about oneself', () => {
    createMaternityCase(db, traeger, { facilityId: 1, ownEmployeeId: null }, leaId, input({ notifiedOn: '2026-11-19', expectedBirth: '2027-04-01' }), TODAY)
    create({ notifiedOn: '2026-11-19', expectedBirth: '2027-04-01', authorityNotifiedOn: '2026-11-19', riskAssessmentOn: '2026-11-19' })
    expect(tasks(leitung)).toEqual(['Anna Muster: banCheck today'])
    expect(tasks(traeger)).toContain('Lea Leitung: authority today')
    expect(tasks(leitung, { onTablet: true })).toEqual([])
    expect(tasks(leitung, { permissions: permissionsOf('group_lead') })).toEqual([])
    expect(listReminders(db, asChildViewer(leitung), TODAY).filter(item => item.kind === 'maternity').map(item => item.name)).toEqual(['Anna Muster'])
  })
})

describe('the plan hints (§§ 4–6 MuSchG)', () => {
  const editor = () => ({ ...leitung, permissions: new Set([...leitung.permissions].filter(key => key !== 'employees.sickness')) }) as SessionUser
  const warnings = (viewer: SessionUser, month = 11, year = 2026) => getMonthPlan(db, viewer, 1, year, month, TODAY).admin!.warnings
    .filter(warning => warning.type === 'maternity' || warning.type === 'work_limit')
  const rules = (viewer: SessionUser) => warnings(viewer)
    .map(warning => (warning.type === 'maternity' ? `${warning.date} ${warning.rule} ${warning.value}/${warning.limit}` : `${warning.date} ${warning.type}`))

  beforeEach(() => {
    create({ notifiedOn: '2026-11-02', expectedBirth: '2027-04-01' })
  })

  it('flags more than 8:30 h, work after 20:00, short rest and Sunday work while the case applies', () => {
    shiftOn(anna, '2026-10-29', 420, 1050) // before the notice: nothing
    shiftOn(anna, '2026-11-18', 420, 1020, 720, 750) // 9:30 h
    shiftOn(anna, '2026-11-19', 720, 1230) // until 20:30
    shiftOn(anna, '2026-11-20', 420, 600) // 10:30 h of rest
    shiftOn(anna, '2026-11-22', 540, 720) // Sunday
    expect(rules(leitung)).toEqual([
      '2026-11-18 hours 570/510', '2026-11-19 late 1230/1200', '2026-11-20 rest 630/660', '2026-11-22 sunday 180/0',
    ])
    expect(warnings(leitung, 10)).toEqual([])
  })

  it('allows only 8:00 h under 18', () => {
    db.update(employees).set({ birthday: '12-01', birthYear: 2008 }).where(eq(employees.id, anna)).run()
    shiftOn(anna, '2026-11-18', 420, 960, 720, 750) // 8:30 h
    shiftOn(anna, '2026-12-02', 420, 960, 720, 750) // 18 by then
    expect(rules(leitung)).toEqual(['2026-11-18 hours 510/480'])
    expect(warnings(leitung, 12)).toEqual([])
  })

  it('flags a monthly average above the contractual weekly hours', () => {
    db.delete(maternityCases).run()
    const ben = addEmployee(db, 'Bea Beispiel', { weeklyHours: 20 })
    create({ notifiedOn: '2026-11-02', expectedBirth: '2027-04-01' }, ben)
    // 5 h on each weekday from 02.11. to 30.11. (21 days): 105 h in 29 days = Ø 25:21 h a week.
    for (const date of dateRange('2026-11-02', '2026-11-30')) {
      if (isWorkday(loadEmployee(db, ben)!.info, date)) shiftOn(ben, date, 480, 780)
    }
    expect(rules(leitung)).toEqual(['2026-11-30 average 1521/1200'])
  })

  it('shows plan editors who may not see the case only „Arbeitszeitgrenze überschritten“, once per person and day', () => {
    shiftOn(anna, '2026-11-22', 420, 1260, 720, 750) // Sunday, 13:30 h, until 21:00
    expect(rules(leitung)).toEqual(['2026-11-22 hours 810/510', '2026-11-22 late 1260/1200', '2026-11-22 sunday 810/0'])
    expect(warnings(editor())).toEqual([{ type: 'work_limit', date: '2026-11-22', employeeId: anna, minutes: 810 }])
  })

  it('end with the case', () => {
    db.update(maternityCases).set({ endedOn: '2026-11-20' }).run()
    shiftOn(anna, '2026-11-18', 420, 1020, 720, 750)
    shiftOn(anna, '2026-11-24', 420, 1020, 720, 750)
    expect(rules(leitung)).toEqual(['2026-11-18 hours 570/510'])
  })
})
