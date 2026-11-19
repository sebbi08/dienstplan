import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getStaffYearCalendar } from '../../server/services/calendar'
import { applyToCells } from '../../server/services/entries'
import {
  calendarLeaveRequests, createLeaveRequest, decideLeaveRequest, setLeaveModule, setMaxConcurrent, withdrawLeaveRequest,
} from '../../server/services/leaveRequests'
import type { SessionUser } from '../../shared/types/api'
import { saveBundleOverride } from '../../server/services/permissions'
import { addEmployee, addFacility, addUser, codeId, createTestDb, makePlanner } from '../helpers/fixtures'

const today = '2026-10-07'
const now = new Date('2026-10-07T10:00:00Z')

describe('open leave requests in the year calendar', () => {
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
    setLeaveModule(db, { enabled: true, plannerIds: [] })
  })
  const request = (user: SessionUser, from: string, to: string, kind: 'vacation' | 'overtime_off' = 'vacation') =>
    createLeaveRequest(db, user, { from, to, note: '', kind }, today, now)

  it('sends the open requests only to the Leitung, the Träger and the leave planners', () => {
    const id = request(annaUser, '2026-11-02', '2026-11-04')
    const groupLead = addUser(db, 'gl', 'group_lead', addEmployee(db, 'Gisela'))
    for (const user of [annaUser, bertaUser, groupLead]) expect(calendarLeaveRequests(db, user, 1, 2026), user.username).toBeNull()
    // A Mitarbeiter planning leave (with the leave overview that planning needs).
    saveBundleOverride(db, bertaUser.id, 'employeesView', 'grant')
    for (const user of [leitung, provider, makePlanner(db, bertaUser)]) {
      expect(calendarLeaveRequests(db, user, 1, 2026)?.requests.map(open => open.id), user.username).toEqual([id])
    }
    // The staff calendar (employees, Meins → Kalender) never carries requests.
    expect(getStaffYearCalendar(db, 1, 2026, anna)).not.toHaveProperty('requests')
    // While leave requests are off, nobody gets them.
    setLeaveModule(db, { enabled: false, plannerIds: [] })
    expect(calendarLeaveRequests(db, leitung, 1, 2026)).toBeNull()
  })

  it('lists only open requests with their days, kind, days counted and when they were made', () => {
    const open = request(annaUser, '2026-11-02', '2026-11-08') // Mo–So: five working days
    const ueF = request(bertaUser, '2026-12-01', '2026-12-01', 'overtime_off')
    const approved = request(annaUser, '2026-11-16', '2026-11-16')
    const rejected = request(bertaUser, '2026-11-17', '2026-11-17')
    const withdrawn = request(bertaUser, '2026-11-18', '2026-11-18')
    decideLeaveRequest(db, provider, 1, approved, { approve: true, note: '', overwrite: false }, now)
    decideLeaveRequest(db, provider, 1, rejected, { approve: false, note: '', overwrite: false }, now)
    withdrawLeaveRequest(db, bertaUser, withdrawn, now)
    const overlay = calendarLeaveRequests(db, leitung, 1, 2026)!
    expect(overlay.requests).toEqual([
      {
        id: open, employeeId: anna, kind: 'vacation', startDate: '2026-11-02', endDate: '2026-11-08', workdays: 5,
        createdAt: now.toISOString(), dates: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
      },
      {
        id: ueF, employeeId: berta, kind: 'overtime_off', startDate: '2026-12-01', endDate: '2026-12-01', workdays: 1,
        createdAt: now.toISOString(), dates: ['2026-12-01'],
      },
    ])
    // Other years and other facilities stay out.
    request(annaUser, '2027-01-11', '2027-01-12')
    expect(calendarLeaveRequests(db, leitung, 1, 2026)!.requests).toHaveLength(2)
    expect(calendarLeaveRequests(db, leitung, 1, 2027)!.requests).toHaveLength(1)
    const krippe = addFacility(db, 'Krippe')
    expect(calendarLeaveRequests(db, addUser(db, 'leitung-b', 'admin', null, krippe), krippe, 2026)!.requests).toEqual([])
  })

  it('marks the days on which planned leave and open requests together exceed the limit', () => {
    makePlanner(db, leitung)
    applyToCells(db, leitung, 1, [{ employeeId: berta, date: '2026-11-03' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    request(annaUser, '2026-11-02', '2026-11-04')
    expect(calendarLeaveRequests(db, leitung, 1, 2026)).toMatchObject({ maxConcurrent: null, overLimit: {} })
    setMaxConcurrent(db, leitung, 1, 1)
    expect(calendarLeaveRequests(db, leitung, 1, 2026)).toMatchObject({ maxConcurrent: 1, overLimit: { '2026-11-03': 2 } })
  })

  it('adds the requests in the office calendar route only', () => {
    const source = (file: string) => readFileSync(join(process.cwd(), 'server', 'api', file), 'utf8')
    expect(source('calendar.get.ts')).toContain('calendarLeaveRequests(db, admin, admin.facilityId, year)')
    expect(source('my/calendar.get.ts')).not.toContain('calendarLeaveRequests')
  })
})
