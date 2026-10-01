import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getBalanceOverview } from '../../server/services/balances'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { addAdjustment, setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount, getLeaveOverview } from '../../server/services/leave'
import { stamp } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']

describe('balances and leave', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna', { validFrom: '2026-10-05' })
  })

  it('computes the balance today and at month end', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    addAdjustment(db, anna, { date: '2026-10-05', minutes: 750, reason: 'Übertrag' })
    expect(getBalanceOverview(db, 2026, 10, '2026-10-09')).toEqual([
      { employeeId: anna, name: 'Anna', weeklyMinutes: 2340, today: 735, monthEnd: 735 - 15 * 468, previousMonthEnd: 0 },
    ])
  })
  it('carries the balance at the end of the previous month, including earlier bookings', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    addAdjustment(db, anna, { date: '2026-09-30', minutes: 750, reason: 'Übertrag aus altem Plan' })
    const [october] = getBalanceOverview(db, 2026, 10, '2026-10-09')
    expect(october!.previousMonthEnd).toBe(750)
    const [november] = getBalanceOverview(db, 2026, 11, '2026-10-09')
    expect(november!.previousMonthEnd).toBe(october!.monthEnd)
  })
  it('excludes employees who are not employed in the month', () => {
    addEmployee(db, 'Carl', { validFrom: '2026-11-01' })
    expect(getBalanceOverview(db, 2026, 10, '2026-10-09').map(b => b.name)).toEqual(['Anna'])
  })
  it('computes the leave account with ranges', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    setEntitlement(db, anna, 2026, { days: 30, carriedOverDays: 3 })
    expect(getLeaveAccount(db, anna, 2026, '2026-10-07')).toEqual({
      employeeId: anna, name: 'Anna', year: 2026,
      account: { entitlement: 30, carriedOver: 3, taken: 2, planned: 3, available: 28 },
      ranges: [{ from: '2026-10-05', to: '2026-10-09', days: 5 }],
    })
    expect(getLeaveOverview(db, 2026, '2026-10-07')).toHaveLength(1)
  })
  it('uses recorded time for past days and counts “today” until yesterday', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    setTimeTrackingFrom(db, '2026-10-05')
    stamp(db, anna, 'in', 'self', new Date('2026-10-05T05:00:00Z')) // 7:00
    stamp(db, anna, 'out', 'self', new Date('2026-10-05T14:30:00Z')) // 16:30 → 570 min
    const [balance] = getBalanceOverview(db, 2026, 10, '2026-10-07')
    // 05.10.: 570 − 468; 06.10.: nothing recorded → −468; 07.10. (today) not included
    expect(balance!.today).toBe((570 - 468) - 468)
    // month end: 05./06. recorded, 07.–09. planned M (465 each), rest of October target only
    expect(balance!.monthEnd).toBe((570 - 468) - 468 + 3 * (465 - 468) - 15 * 468)
  })
  it('ignores records before the start date', () => {
    setTimeTrackingFrom(db, '2026-10-05')
    stamp(db, anna, 'in', 'self', new Date('2026-10-05T05:00:00Z'))
    stamp(db, anna, 'out', 'self', new Date('2026-10-05T14:30:00Z'))
    setTimeTrackingFrom(db, '2026-10-06')
    const [balance] = getBalanceOverview(db, 2026, 10, '2026-10-07')
    expect(balance!.today).toBe(-468 /* 05.10. plan: nothing planned */ - 468 /* 06.10. nothing recorded */)
  })
})
