import { describe, expect, it } from 'vitest'
import { leaveExtraDays } from '../../server/db/schema'
import { previewClosuresForEmployee } from '../../server/services/closurePreview'
import { createClosure } from '../../server/services/closures'
import { deleteTimeData } from '../../server/services/employeeDeletion'
import { createEmployee, getEmployee, setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { addLeaveExtraDays, deleteLeaveExtraDays } from '../../server/services/leaveExtraDays'
import { getMyLeaveForfeitNotice } from '../../server/services/leaveForfeit'
import { setLeaveModule } from '../../server/services/leaveRequests'
import { getLeaveYearList } from '../../server/services/leaveYearList'
import { rolePermissions } from '../../server/services/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addUser, codeId, createTestDb, errorCode, makePlanner } from '../helpers/fixtures'

const today = '2026-11-20'
const now = new Date('2026-11-20T09:00:00.000Z')
const THANKS = { year: 2026, days: 1, reason: 'Dank für Sommerfest' }

function setup() {
  const db = createTestDb()
  const leitung = addUser(db, 'leitung', 'admin')
  const anna = createEmployee(db, leitung, 1, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
  setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
  const vacation = (dates: string[]) =>
    applyToCells(db, leitung, 1, dates.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
  return { db, leitung, anna, vacation }
}

/** A Mitarbeiter account linked to `employeeId` that was given the right to edit employees. */
function staffWithEmployeeRights(db: ReturnType<typeof createTestDb>, username: string, employeeId: number): SessionUser {
  const user = addUser(db, username, 'observer', employeeId)
  return { ...user, facilityId: 1, permissions: new Set([...user.permissions, 'employees.edit', 'employees.view']) }
}

describe('„Zusatztag nur für dieses Jahr“: one-off extra leave days', () => {
  it('raises the available leave of that year only, listed with its reason', () => {
    const { db, leitung, anna } = setup()
    addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    expect(getLeaveAccount(db, anna, 2026, today)).toMatchObject({
      account: { entitlement: 30, extraDays: 1, carriedOver: 0, available: 31 },
      extraDays: [{ days: 1, reason: 'Dank für Sommerfest' }],
    })
  })

  it('does not change the entitlement of the following years; what is left carries over as Resturlaub', () => {
    const { db, leitung, anna, vacation } = setup()
    addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    vacation(['2026-12-01', '2026-12-02']) // 2 days
    expect(getLeaveAccount(db, anna, 2027, today)).toMatchObject({
      account: { entitlement: 30, extraDays: 0, carriedOver: 29, available: 59 }, extraDays: [],
    })
    expect(getEmployee(db, 1, anna, today, rolePermissions(db, 'admin')).entitlements).toEqual([
      expect.objectContaining({ year: 2026, days: 30, carriedOverDays: 0 }),
    ])
    setEntitlement(db, 1, anna, 2027, { days: 30, carriedOverDays: 0 })
    expect(getEmployee(db, 1, anna, today, rolePermissions(db, 'admin')).entitlements[1])
      .toMatchObject({ year: 2027, days: 30, carriedOverDays: 29, carriedAutomatically: true })
  })

  it('adds half days and sums several entries of a year', () => {
    const { db, leitung, anna } = setup()
    addLeaveExtraDays(db, leitung, 1, anna, { year: 2026, days: 0.5, reason: 'Betriebsausflug' }, now)
    addLeaveExtraDays(db, leitung, 1, anna, { year: 2026, days: 1.5, reason: 'Dank für Sommerfest' }, now)
    expect(getLeaveAccount(db, anna, 2026, today)).toMatchObject({
      account: { extraDays: 2, available: 32 },
      extraDays: [{ days: 0.5, reason: 'Betriebsausflug' }, { days: 1.5, reason: 'Dank für Sommerfest' }],
    })
  })

  it('takes 0.5 to 30 days in half days, a reason of 1 to 200 characters (trimmed), and only a year with an entitlement', () => {
    const { db, leitung, anna } = setup()
    const add = (input: Partial<typeof THANKS>) => errorCode(() => addLeaveExtraDays(db, leitung, 1, anna, { ...THANKS, ...input }, now))
    for (const days of [0, -1, 0.25, 1.3, 30.5, 31, Number.NaN]) expect(add({ days }), String(days)).toBe('leave_extra_days_invalid')
    expect(add({ reason: '' })).toBe('reason_required')
    expect(add({ reason: '   ' })).toBe('reason_required')
    expect(add({ reason: 'x'.repeat(201) })).toBe('leave_extra_reason_too_long')
    expect(add({ year: 2025 })).toBe('leave_extra_no_entitlement')
    expect(db.select().from(leaveExtraDays).all()).toHaveLength(0)
    expect(add({ days: 30, reason: `  ${'x'.repeat(200)}  ` })).toBeNull()
    expect(add({ year: 2028, days: 0.5 })).toBeNull() // the entitlement of 2026 carries into 2028
    expect(db.select().from(leaveExtraDays).all().map(row => [row.year, row.days, row.reason.length])).toEqual([[2026, 30, 200], [2028, 0.5, 19]])
  })

  it('records who added it and when; the employee page lists every year', () => {
    const { db, leitung, anna } = setup()
    const id = addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    expect(getEmployee(db, 1, anna, today, rolePermissions(db, 'admin')).leaveExtraDays).toEqual([
      { id, year: 2026, days: 1, reason: 'Dank für Sommerfest', createdBy: 'leitung', createdAt: '2026-11-20T09:00:00.000Z' },
    ])
  })

  it('is for whoever may edit the entitlement: not without the right, and never for the own record of a Mitarbeiter', () => {
    const { db, leitung, anna } = setup()
    const ben = createEmployee(db, leitung, 1, { name: 'Ben', shortName: 'BE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setEntitlement(db, 1, ben, 2026, { days: 30, carriedOverDays: 0 })
    // A Mitarbeiter without employee rights (Ben's account), and one who was given them (Anna's account).
    const plain = addUser(db, 'ben', 'observer', ben)
    expect(errorCode(() => addLeaveExtraDays(db, { ...plain, facilityId: 1 }, 1, anna, THANKS, now))).toBe('forbidden')
    const withRights = staffWithEmployeeRights(db, 'anna', anna)
    expect(errorCode(() => addLeaveExtraDays(db, withRights, 1, anna, THANKS, now))).toBe('own_account')
    const forBen = addLeaveExtraDays(db, withRights, 1, ben, THANKS, now)
    const forAnna = addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    expect(errorCode(() => deleteLeaveExtraDays(db, withRights, 1, anna, forAnna))).toBe('own_account')
    expect(errorCode(() => deleteLeaveExtraDays(db, { ...plain, facilityId: 1 }, 1, ben, forBen))).toBe('forbidden')
    expect(errorCode(() => deleteLeaveExtraDays(db, withRights, 1, ben, forBen))).toBeNull()
    // The Leitung may add for the own record, as for the entitlement.
    const cleo = createEmployee(db, leitung, 1, { name: 'Cleo', shortName: 'CL', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    setEntitlement(db, 1, cleo, 2026, { days: 30, carriedOverDays: 0 })
    const leitungCleo = addUser(db, 'leitung-cleo', 'admin', cleo)
    expect(errorCode(() => addLeaveExtraDays(db, leitungCleo, 1, cleo, THANKS, now))).toBeNull()
  })

  it('keeps to the facility: another facility\'s employee or entry is not found', () => {
    const { db, leitung, anna } = setup()
    const other = addFacility(db, 'Hort')
    const leitungHort = addUser(db, 'hort', 'admin', null, other)
    const id = addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    expect(errorCode(() => addLeaveExtraDays(db, leitungHort, other, anna, THANKS, now))).toBe('employee_not_found')
    expect(errorCode(() => deleteLeaveExtraDays(db, leitungHort, other, anna, id))).toBe('employee_not_found')
    expect(getLeaveAccount(db, anna, 2026, today).account.extraDays).toBe(1)
  })

  it('deletes an entry of the employee; an unknown one or one of another employee is 404', () => {
    const { db, leitung, anna } = setup()
    const ben = createEmployee(db, leitung, 1, { name: 'Ben', shortName: 'BE', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    const id = addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    expect(errorCode(() => deleteLeaveExtraDays(db, leitung, 1, ben, id))).toBe('leave_extra_day_not_found')
    expect(errorCode(() => deleteLeaveExtraDays(db, leitung, 1, anna, id + 99))).toBe('leave_extra_day_not_found')
    deleteLeaveExtraDays(db, leitung, 1, anna, id)
    expect(getLeaveAccount(db, anna, 2026, today)).toMatchObject({ account: { extraDays: 0, available: 30 }, extraDays: [] })
  })

  it('shows in the own leave overview, the year list of Urlaubsplanung and the closure leave preview', () => {
    const { db, leitung, anna } = setup()
    addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    // The own overview (GET /api/my/leave): the reason is visible to the person.
    expect(getLeaveAccount(db, anna, 2026, today, true).extraDays).toEqual([{ days: 1, reason: 'Dank für Sommerfest' }])
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    const list = getLeaveYearList(db, makePlanner(db, leitung), 1, 2026, {}, today)
    expect(list.people.find(person => person.employeeId === anna)).toMatchObject({
      account: { entitlement: 30, extraDays: 1, available: 31 }, extraDays: [{ days: 1, reason: 'Dank für Sommerfest' }],
    })
    createClosure(db, leitung, 1, { startDate: '2026-12-28', endDate: '2026-12-30', label: 'Weihnachten', mode: 'vacation' })
    const [current, coming] = previewClosuresForEmployee(db, 1, anna, today)
    expect(current).toMatchObject({ year: 2026, entitlementDays: 31 })
    expect(coming).toMatchObject({ year: 2027, entitlementDays: 30 })
  })

  it('counts in the notice on remaining leave like the other carried-over days', () => {
    const { db, leitung, anna, vacation } = setup()
    vacation(['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-09', '2026-02-10', '2026-02-11',
      '2026-02-12', '2026-02-13', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
      '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11']) // 28 of 30 days
    const annaUser = addUser(db, 'anna', 'observer', anna)
    expect(getMyLeaveForfeitNotice(db, annaUser, '2027-01-10')).toMatchObject({ year: 2026, days: 2 })
    addLeaveExtraDays(db, leitung, 1, anna, { year: 2026, days: 1.5, reason: 'Dank für Sommerfest' }, now)
    expect(getMyLeaveForfeitNotice(db, annaUser, '2027-01-10')).toMatchObject({ year: 2026, days: 3.5 })
  })

  it('goes with the leave data of the employee', () => {
    const { db, leitung, anna } = setup()
    addLeaveExtraDays(db, leitung, 1, anna, THANKS, now)
    db.transaction(tx => deleteTimeData(tx, anna))
    expect(db.select().from(leaveExtraDays).all()).toHaveLength(0)
  })
})
