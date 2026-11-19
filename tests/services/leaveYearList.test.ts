import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createClosure } from '../../server/services/closures'
import { setEntitlement } from '../../server/services/employees'
import { getLeaveAccount } from '../../server/services/leave'
import { enterLeave } from '../../server/services/leaveEntries'
import { createLeaveRequest, decideLeaveRequest, setLeaveModule, withdrawLeaveRequest } from '../../server/services/leaveRequests'
import { getLeaveYearList } from '../../server/services/leaveYearList'
import type { LeaveYearListFilter, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, makePlanner } from '../helpers/fixtures'

const today = '2026-10-07'
const now = new Date('2026-10-07T10:00:00Z')

describe('Urlaubsplanung: Alle Anträge und Urlaube', () => {
  let db: Db
  let provider: SessionUser
  let leitung: SessionUser
  let anna: number
  let berta: number
  let annaUser: SessionUser
  let bertaUser: SessionUser
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    leitung = makePlanner(db, addUser(db, 'leitung', 'admin'))
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    annaUser = addUser(db, 'anna', 'observer', anna)
    bertaUser = addUser(db, 'berta', 'observer', berta)
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 2 })
    setEntitlement(db, 1, berta, 2026, { days: 28, carriedOverDays: 0 })
  })
  const request = (user: SessionUser, from: string, to: string, kind: 'vacation' | 'overtime_off' = 'vacation') =>
    createLeaveRequest(db, user, { from, to, note: '', kind }, today, now)
  const decide = (id: number, approve: boolean, note = '') =>
    decideLeaveRequest(db, leitung, 1, id, { approve, note, overwrite: true }, new Date('2026-10-08T09:00:00Z'))
  const list = (filter: LeaveYearListFilter = {}, user = leitung) => getLeaveYearList(db, user, 1, 2026, filter, today)

  it('is for the leave planners only, as the planning page', () => {
    for (const user of [annaUser, addUser(db, 'leitung2', 'admin')]) {
      expect(errorCode(() => list({}, user)), user.username).toBe('not_leave_planner')
    }
    expect(list({}, provider).year).toBe(2026)
    setLeaveModule(db, { enabled: false, plannerIds: [] })
    expect(errorCode(() => list())).toBe('leave_requests_off')
  })

  it('lists every request of the year with its status, decision and reason, and who may decide it here', () => {
    const approved = request(annaUser, '2026-11-02', '2026-11-04')
    const rejected = request(bertaUser, '2026-11-09', '2026-11-10')
    const withdrawn = request(bertaUser, '2026-11-16', '2026-11-16')
    const open = request(annaUser, '2026-12-01', '2026-12-02', 'overtime_off')
    const nextYear = request(annaUser, '2027-01-11', '2027-01-12')
    decide(approved, true)
    decide(rejected, false, 'Teamfahrt')
    withdrawLeaveRequest(db, bertaUser, withdrawn)
    const all = list()
    expect(all.requests.map(row => [row.id, row.name, row.status, row.kind, row.workdays, row.canDecide])).toEqual([
      [approved, 'Anna', 'approved', 'vacation', 3, false],
      [rejected, 'Berta', 'rejected', 'vacation', 2, false],
      [withdrawn, 'Berta', 'withdrawn', 'vacation', 1, false],
      [open, 'Anna', 'open', 'overtime_off', 2, true],
    ])
    expect(all.requests.map(row => row.id)).not.toContain(nextYear)
    expect(all.requests[1]).toMatchObject({ decidedBy: 'leitung', decisionNote: 'Teamfahrt', decidedAt: '2026-10-08T09:00:00.000Z', createdAt: now.toISOString() })
    expect(all.employees.map(employee => employee.name)).toEqual(['Anna', 'Berta'])

    // A planner's own request is listed, but decided by someone else (the Träger decides their own too).
    const carla = addEmployee(db, 'Carla')
    const leitungCarla = makePlanner(db, addUser(db, 'leitung-carla', 'admin', carla))
    const own = request(leitungCarla, '2026-11-23', '2026-11-23')
    expect(list({}, leitungCarla).requests.find(row => row.id === own)?.canDecide).toBe(false)
    expect(list({}, provider).requests.find(row => row.id === own)?.canDecide).toBe(true)
  })

  it('tells the origin of every leave period: an approved request, entered directly or a closure', () => {
    const approved = request(annaUser, '2026-11-02', '2026-11-04') // Mo–Mi
    decide(approved, true)
    // Directly entered right after the request (Do–Fr): its own period, although the days touch.
    enterLeave(db, leitung, 1, anna, { from: '2026-11-05', to: '2026-11-06', kind: 'vacation', overwrite: false }, now)
    enterLeave(db, leitung, 1, anna, { from: '2026-11-12', to: '2026-11-12', kind: 'special_leave', overwrite: false }, now)
    // Überstundenfrei approved; the same kind of code entered directly elsewhere stays „direkt“.
    decide(request(annaUser, '2026-11-17', '2026-11-17', 'overtime_off'), true)
    enterLeave(db, leitung, 1, anna, { from: '2026-11-18', to: '2026-11-18', kind: 'overtime_off', overwrite: false }, now)
    createClosure(db, provider, 1, { startDate: '2026-12-28', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' }, now)

    const anna2026 = list().people.find(person => person.employeeId === anna)!
    expect(anna2026.ranges.map(range => [range.kind, range.from, range.to, range.days, range.origin, range.requestId, range.closureLabel])).toEqual([
      ['vacation', '2026-11-02', '2026-11-04', 3, 'request', approved, null],
      ['vacation', '2026-11-05', '2026-11-06', 2, 'direct', null, null],
      ['special_leave', '2026-11-12', '2026-11-12', 1, 'direct', null, null],
      ['overtime_off', '2026-11-17', '2026-11-17', 1, 'request', expect.any(Number), null],
      ['overtime_off', '2026-11-18', '2026-11-18', 1, 'direct', null, null],
      ['vacation', '2026-12-28', '2026-12-31', 4, 'closure', null, 'Weihnachten'],
    ])
    expect(anna2026.ranges[0]!.decidedAt).toBe('2026-10-08T09:00:00.000Z')
  })

  it('gives each person the summary line of their leave account', () => {
    decide(request(annaUser, '2026-11-02', '2026-11-04'), true)
    enterLeave(db, leitung, 1, anna, { from: '2026-03-02', to: '2026-03-03', kind: 'vacation', overwrite: false }, now)
    createClosure(db, provider, 1, { startDate: '2026-12-28', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' }, now)
    for (const person of list().people) {
      const account = getLeaveAccount(db, person.employeeId, 2026, today)
      expect(person.account, person.name).toEqual(account.account)
      expect(person.hasEntitlement).toBe(true)
    }
    expect(list().people.find(person => person.employeeId === anna)!.account).toMatchObject({
      entitlement: 30, carriedOver: 2, taken: 2, planned: 7, available: 23,
    })
  })

  it('filters by person, kind and status, „direkt eingetragen“ included', () => {
    const approved = request(annaUser, '2026-11-02', '2026-11-04')
    decide(approved, true)
    const open = request(bertaUser, '2026-11-09', '2026-11-10')
    const rejected = request(bertaUser, '2026-11-16', '2026-11-16')
    decide(rejected, false)
    enterLeave(db, leitung, 1, berta, { from: '2026-11-23', to: '2026-11-24', kind: 'vacation', overwrite: false }, now)
    enterLeave(db, leitung, 1, anna, { from: '2026-11-12', to: '2026-11-12', kind: 'special_leave', overwrite: false }, now)
    createClosure(db, provider, 1, { startDate: '2026-12-28', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' }, now)

    const ids = (filter: LeaveYearListFilter) => list(filter).requests.map(row => row.id)
    const periods = (filter: LeaveYearListFilter) =>
      list(filter).people.map(person => [person.name, person.ranges.map(range => `${range.from}:${range.origin}`)])

    expect(ids({ employeeId: berta })).toEqual([open, rejected])
    expect(periods({ employeeId: berta })).toEqual([['Berta', ['2026-11-23:direct', '2026-12-28:closure']]])
    expect(ids({ status: 'open' })).toEqual([open])
    expect(periods({ status: 'open' })).toEqual([])
    expect(ids({ status: 'rejected' })).toEqual([rejected])
    expect(ids({ status: 'approved' })).toEqual([approved])
    expect(periods({ status: 'approved' })).toEqual([['Anna', ['2026-11-02:request']]])
    // Directly entered leave has no request.
    expect(ids({ status: 'direct' })).toEqual([])
    expect(periods({ status: 'direct' })).toEqual([['Anna', ['2026-11-12:direct']], ['Berta', ['2026-11-23:direct']]])
    expect(ids({ kind: 'special_leave' })).toEqual([])
    expect(periods({ kind: 'special_leave' })).toEqual([['Anna', ['2026-11-12:direct']]])
    expect(ids({ kind: 'overtime_off' })).toEqual([])
    expect(periods({ kind: 'vacation', status: 'direct' })).toEqual([['Berta', ['2026-11-23:direct']]])
    // Without kind and status everyone is listed, also without leave periods.
    const carla = addEmployee(db, 'Carla')
    expect(list().people.map(person => person.employeeId)).toEqual([anna, berta, carla])
  })

  it('shows an open request decided from the list as approved, its days as from the request', () => {
    const id = request(annaUser, '2026-11-02', '2026-11-04')
    const row = list().requests.find(candidate => candidate.id === id)!
    expect(row.canDecide).toBe(true)
    decide(row.id, true)
    const after = list()
    expect(after.requests.find(candidate => candidate.id === id)).toMatchObject({ status: 'approved', canDecide: false, decidedBy: 'leitung' })
    expect(after.people.find(person => person.employeeId === anna)!.ranges).toMatchObject([{ origin: 'request', requestId: id }])
  })
})
