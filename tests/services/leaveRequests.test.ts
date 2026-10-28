import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { balanceAdjustments, changeLog } from '../../server/db/schema'
import { createClosure } from '../../server/services/closures'
import { setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import {
  createLeaveRequest, decideLeaveRequest, getLeavePlanning, getLeaveSettings, listMyLeaveRequests, listOpenRequests,
  previewLeaveRequest, setLeaveModule, setMaxConcurrent, withdrawLeaveRequest,
} from '../../server/services/leaveRequests'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import {
  addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, makePlanner, refreshPermissions, templateId,
} from '../helpers/fixtures'

const today = '2026-10-07'

describe('leave requests', () => {
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
    leitung = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    annaUser = addUser(db, 'anna', 'observer', anna)
    bertaUser = addUser(db, 'berta', 'observer', berta)
  })
  const request = (user: SessionUser, from: string, to: string) => createLeaveRequest(db, user, { from, to, note: '' }, today)

  it('stays invisible and closed until the Träger switches it on', () => {
    expect(getLeaveSettings(db, annaUser)).toMatchObject({ enabled: false, isPlanner: false, plannerIds: [] })
    expect(errorCode(() => request(annaUser, '2026-11-02', '2026-11-06'))).toBe('leave_requests_off')
    setLeaveModule(db, { enabled: true, plannerIds: [provider.id] })
    expect(getLeaveSettings(db, leitung)).toMatchObject({ enabled: true, isPlanner: false, plannerIds: [] })
    // Who plans is the right „planen und genehmigen“; the list only names the Träger accounts told about new requests.
    makePlanner(db, leitung)
    expect(getLeaveSettings(db, leitung)).toMatchObject({ enabled: true, isPlanner: true, plannerIds: [] })
    expect(getLeaveSettings(db, provider)).toMatchObject({ isPlanner: true, plannerIds: [provider.id] })
    expect(getLeaveSettings(db, annaUser)).toMatchObject({ isPlanner: false, plannerIds: [] })
    for (const account of [annaUser, leitung]) {
      expect(errorCode(() => setLeaveModule(db, { enabled: true, plannerIds: [account.id] })), account.username).toBe('invalid_leave_planner')
    }
    // The module switch leaves the right alone.
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    expect(getLeaveSettings(db, refreshPermissions(db, leitung))).toMatchObject({ isPlanner: true, plannerIds: [] })
  })

  it('lets employees request leave, shows the days and the remaining leave, and withdraw open requests', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    setEntitlement(db, 1, anna, 2026, { days: 30, carriedOverDays: 0 })
    // Mo 2.11. – So 8.11.: five working days
    expect(previewLeaveRequest(db, annaUser, '2026-11-02', '2026-11-08', today)).toEqual({ workdays: 5, availableAfter: 25, overLimitDates: [] })
    const id = request(annaUser, '2026-11-02', '2026-11-08')
    expect(errorCode(() => request(annaUser, '2026-11-06', '2026-11-10'))).toBe('leave_request_overlaps')
    expect(errorCode(() => request(annaUser, '2026-10-01', '2026-10-02'))).toBe('leave_in_past')
    expect(errorCode(() => request(annaUser, '2026-11-07', '2026-11-08'))).toBe('no_leave_days') // weekend only
    expect(listMyLeaveRequests(db, annaUser)).toMatchObject([{ id, status: 'open', workdays: 5 }])
    expect(errorCode(() => withdrawLeaveRequest(db, bertaUser, id))).toBe('leave_request_not_found')
    withdrawLeaveRequest(db, annaUser, id)
    expect(listMyLeaveRequests(db, annaUser)[0]!.status).toBe('withdrawn')
  })

  it('lets planners approve into the plan, but never their own request, and asks before overwriting duties', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    makePlanner(db, leitung)
    const id = request(annaUser, '2026-11-02', '2026-11-04')
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-03' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(errorCode(() => decideLeaveRequest(db, annaUser, 1, id, { approve: true, note: '', overwrite: false }))).toBe('not_leave_planner')
    expect(errorCode(() => decideLeaveRequest(db, leitung, 1, id, { approve: true, note: '', overwrite: false }))).toBe('cells_occupied')
    decideLeaveRequest(db, leitung, 1, id, { approve: true, note: 'Gute Erholung', overwrite: true })
    expect(loadEntries(db, { employeeId: anna }).map(e => [e.date, e.codeKey])).toEqual([
      ['2026-11-02', 'vacation'], ['2026-11-03', 'vacation'], ['2026-11-04', 'vacation'],
    ])
    expect(listMyLeaveRequests(db, annaUser)[0]).toMatchObject({ status: 'approved', decidedBy: 'leitung', decisionNote: 'Gute Erholung' })
    expect(errorCode(() => decideLeaveRequest(db, leitung, 1, id, { approve: false, note: '', overwrite: false }))).toBe('leave_request_decided')

    // A planner's own request goes to someone else; the Träger may always decide.
    const leitungWithEmployee = addUser(db, 'leitung2', 'admin', addEmployee(db, 'Carla'))
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    makePlanner(db, leitungWithEmployee)
    const own = request(leitungWithEmployee, '2026-11-09', '2026-11-09')
    expect(listOpenRequests(db, leitungWithEmployee, 1)).toEqual([])
    expect(errorCode(() => decideLeaveRequest(db, leitungWithEmployee, 1, own, { approve: true, note: '', overwrite: false }))).toBe('own_leave_request')
    decideLeaveRequest(db, provider, 1, own, { approve: false, note: 'Teamfahrt', overwrite: false })
    expect(listMyLeaveRequests(db, leitungWithEmployee)[0]).toMatchObject({ status: 'rejected', decisionNote: 'Teamfahrt' })
  })

  it('counts planned leave and open requests per day, without closures, and warns above the limit', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    makePlanner(db, leitung)
    setMaxConcurrent(db, leitung, 1, 1)
    expect(errorCode(() => setMaxConcurrent(db, annaUser, 1, 3))).toBe('not_leave_planner')
    createClosure(db, provider, 1, { startDate: '2026-12-24', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' })
    applyToCells(db, leitung, 1, [{ employeeId: berta, date: '2026-11-03' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    expect(previewLeaveRequest(db, annaUser, '2026-11-02', '2026-11-04', today).overLimitDates).toEqual(['2026-11-03'])
    request(annaUser, '2026-11-02', '2026-11-04')
    expect(listOpenRequests(db, leitung, 1)[0]!.overLimitDates).toEqual(['2026-11-03'])
    // Closure days are not leave requests' days and do not count.
    expect(previewLeaveRequest(db, bertaUser, '2026-12-23', '2026-12-31', today)).toMatchObject({ workdays: 1, overLimitDates: [] })

    const planning = getLeavePlanning(db, leitung, 1, 2026)
    expect([planning.counts['2026-11-02'], planning.counts['2026-11-03'], planning.counts['2026-12-28']]).toEqual([1, 2, undefined])
    expect(planning.calendar.days[anna]!['2026-11-02']).toBe('requested')
    expect(planning.calendar.days[berta]!['2026-11-03']).toBe('vacation')
    expect(planning.maxConcurrent).toBe(1)
    expect(planning.openRequests).toHaveLength(1)
    expect(getLeaveSettings(db, leitung).openCount).toBe(1)
  })

  it('asks before approving over a help-out day and then replaces the help-out, logged in the other facility', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    makePlanner(db, leitung)
    const krippe = addFacility(db, 'Krippe')
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    addHelpOut(db, anna, krippe, 2026, 11)
    releaseMonth(db, leitungB, krippe, 2026, 11, new Date('2026-10-01T10:00:00Z'))
    applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: '2026-11-03' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1', krippe) })
    const id = request(annaUser, '2026-11-02', '2026-11-04')
    expect(errorCode(() => decideLeaveRequest(db, leitung, 1, id, { approve: true, note: '', overwrite: false }))).toBe('cells_occupied')
    expect(loadEntries(db, { employeeId: anna }).map(e => [e.date, e.helpFacilityId])).toEqual([['2026-11-03', krippe]])
    decideLeaveRequest(db, leitung, 1, id, { approve: true, note: '', overwrite: true })
    expect(loadEntries(db, { employeeId: anna }).map(e => [e.date, e.codeKey, e.helpFacilityId])).toEqual([
      ['2026-11-02', 'vacation', null], ['2026-11-03', 'vacation', null], ['2026-11-04', 'vacation', null],
    ])
    const logB = db.select().from(changeLog).where(eq(changeLog.facilityId, krippe)).all().filter(row => row.employeeId === anna)
    expect(logB.at(-1)).toMatchObject({ date: '2026-11-03', before: 'F1 7:00–13:15', after: '—', changedBy: leitung.id })
  })

  it('never turns a sick day into leave when approving', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    makePlanner(db, leitung)
    const id = request(annaUser, '2026-11-02', '2026-11-04')
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-03' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    expect(decideLeaveRequest(db, leitung, 1, id, { approve: true, note: '', overwrite: false })).toEqual({ keptAbsences: 1 })
    expect(loadEntries(db, { employeeId: anna }).map(e => [e.date, e.codeKey])).toEqual([
      ['2026-11-02', 'vacation'], ['2026-11-03', 'sick'], ['2026-11-04', 'vacation'],
    ])
  })

  describe('Überstundenfrei', () => {
    let carla: number
    let carlaUser: SessionUser
    beforeEach(() => {
      setLeaveModule(db, { enabled: true, plannerIds: [] })
      makePlanner(db, leitung)
      // Employed from tomorrow with a carried-over balance of +20 h: "Stand heute" is exactly that.
      carla = addEmployee(db, 'Carla', { validFrom: '2026-10-08' })
      carlaUser = addUser(db, 'carla', 'observer', carla)
      setEntitlement(db, 1, carla, 2026, { days: 30, carriedOverDays: 0 })
      db.insert(balanceAdjustments).values({ employeeId: carla, date: '2026-10-07', minutes: 1200, reason: 'Übertrag' }).run()
    })
    const requestOff = (user: SessionUser, from: string, to: string) =>
      createLeaveRequest(db, user, { from, to, note: '', kind: 'overtime_off' }, today)
    const previewOff = (from: string, to: string) => previewLeaveRequest(db, carlaUser, from, to, today, 'overtime_off')

    it('uses no leave days but shows the hours taken from the balance and the balance afterwards', () => {
      // Mo 2.11. – Di 3.11.: two working days of 7:48 h
      expect(previewOff('2026-11-02', '2026-11-03')).toEqual({
        workdays: 2, availableAfter: null, overLimitDates: [], minutesTaken: 936, balanceAfter: 1200 - 936,
      })
      const id = requestOff(carlaUser, '2026-11-02', '2026-11-03')
      expect(listMyLeaveRequests(db, carlaUser)).toMatchObject([{ id, kind: 'overtime_off', status: 'open', workdays: 2 }])
      // Another open Überstundenfrei request is taken off the balance afterwards, not off the leave.
      expect(previewOff('2026-11-09', '2026-11-09')).toMatchObject({ minutesTaken: 468, balanceAfter: 1200 - 936 - 468 })
      expect(previewLeaveRequest(db, carlaUser, '2026-11-09', '2026-11-09', today)).toEqual({ workdays: 1, availableAfter: 29, overLimitDates: [] })
      expect(errorCode(() => request(carlaUser, '2026-11-03', '2026-11-04'))).toBe('leave_request_overlaps')
    })

    it('costs nothing on days the approval keeps as another full-day absence', () => {
      applyToCells(db, leitung, 1, [{ employeeId: carla, date: '2026-11-02' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
      applyToCells(db, leitung, 1, [{ employeeId: carla, date: '2026-11-09' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
      requestOff(carlaUser, '2026-11-09', '2026-11-10') // open: only 10.11. costs
      expect(previewOff('2026-11-02', '2026-11-03')).toMatchObject({ minutesTaken: 468, balanceAfter: 1200 - 468 - 468 })
    })

    it('writes Überstundenfrei into the plan on approval, keeps other absences and still counts it afterwards', () => {
      const id = requestOff(carlaUser, '2026-11-02', '2026-11-04')
      applyToCells(db, leitung, 1, [{ employeeId: carla, date: '2026-11-03' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
      applyToCells(db, leitung, 1, [{ employeeId: carla, date: '2026-11-04' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
      expect(errorCode(() => decideLeaveRequest(db, leitung, 1, id, { approve: true, note: '', overwrite: false }))).toBe('cells_occupied')
      expect(decideLeaveRequest(db, leitung, 1, id, { approve: true, note: '', overwrite: true })).toEqual({ keptAbsences: 1 })
      expect(loadEntries(db, { employeeId: carla }).map(e => [e.date, e.codeKey])).toEqual([
        ['2026-11-02', 'overtime_off'], ['2026-11-03', 'overtime_off'], ['2026-11-04', 'vacation'],
      ])
      expect(listMyLeaveRequests(db, carlaUser)[0]).toMatchObject({ kind: 'overtime_off', status: 'approved' })
      // The approved days are planned now: they still come off the balance of the next request's preview.
      expect(previewOff('2026-11-09', '2026-11-09')).toMatchObject({ minutesTaken: 468, balanceAfter: 1200 - 936 - 468 })
      // Leave stays untouched (only the Urlaub day of 4.11. counts).
      expect(previewLeaveRequest(db, carlaUser, '2026-11-09', '2026-11-09', today).availableAfter).toBe(28)
    })

    it('counts open and approved Überstundenfrei like leave for the people away per day', () => {
      setMaxConcurrent(db, leitung, 1, 1)
      applyToCells(db, leitung, 1, [{ employeeId: berta, date: '2026-11-03' }], 'replace', { kind: 'code', codeId: codeId(db, 'overtime_off') })
      expect(previewOff('2026-11-02', '2026-11-04').overLimitDates).toEqual(['2026-11-03'])
      requestOff(carlaUser, '2026-11-02', '2026-11-04')
      expect(listOpenRequests(db, leitung, 1)).toMatchObject([{ kind: 'overtime_off', overLimitDates: ['2026-11-03'] }])
      const planning = getLeavePlanning(db, leitung, 1, 2026)
      expect([planning.counts['2026-11-02'], planning.counts['2026-11-03']]).toEqual([1, 2])
      expect(planning.calendar.days[carla]!['2026-11-02']).toBe('requested')
      expect(planning.calendar.days[berta]!['2026-11-03']).toBe('overtime_off')
    })
  })

  it('subtracts other open requests from the remaining leave and counts the menu badge for the planners', () => {
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    expect(previewLeaveRequest(db, annaUser, '2026-11-02', '2026-11-03', today).availableAfter).toBeNull() // no entitlement
    setEntitlement(db, 1, anna, 2026, { days: 10, carriedOverDays: 0 })
    request(annaUser, '2026-11-02', '2026-11-06') // 5 days
    expect(previewLeaveRequest(db, annaUser, '2026-11-09', '2026-11-10', today).availableAfter).toBe(3)
    expect(getLeaveSettings(db, provider).openCount).toBe(1) // nobody else plans: the Träger is told
    setLeaveModule(db, { enabled: true, plannerIds: [] })
    makePlanner(db, leitung)
    expect([getLeaveSettings(db, provider), getLeaveSettings(db, leitung)].map(s => [s.isPlanner, s.openCount])).toEqual([[true, 0], [true, 1]])
  })
})
