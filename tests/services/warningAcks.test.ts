import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeHours } from '../../server/db/schema'
import { getMonthPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { acknowledgeWarnings, loadWarningAcks, revokeWarningAcks } from '../../server/services/warningAcks'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const at = new Date('2026-10-23T08:00:00.000Z')
const item = (key: string, signature = '') => ({ key, signature })

describe('warning acknowledgements', () => {
  let db: Db
  let leitung: SessionUser
  let krippe: number
  beforeEach(() => {
    db = createTestDb()
    const anna = addEmployee(db, 'Anna')
    leitung = addUser(db, 'leitung', 'admin', anna)
    krippe = addFacility(db, 'Krippe')
  })

  it('stores who acknowledged what and when, per facility, and returns the month', () => {
    acknowledgeWarnings(db, 1, leitung, [item('missing_entry|2026-10-05|1'), item('target_gap|2026-10-06|1', '90')], at)
    acknowledgeWarnings(db, 1, leitung, [item('missing_entry|2026-11-02|1')], at)
    expect(loadWarningAcks(db, 1, '2026-10-01', '2026-10-31')).toEqual([
      { key: 'missing_entry|2026-10-05|1', signature: '', byName: 'Anna', at: at.toISOString() },
      { key: 'target_gap|2026-10-06|1', signature: '90', byName: 'Anna', at: at.toISOString() },
    ])
    expect(loadWarningAcks(db, krippe, '2026-10-01', '2026-10-31')).toEqual([])
  })

  it('updates the values of a warning acknowledged again', () => {
    acknowledgeWarnings(db, 1, leitung, [item('target_gap|2026-10-06|1', '90')], at)
    acknowledgeWarnings(db, 1, leitung, [item('target_gap|2026-10-06|1', '120')], at)
    expect(loadWarningAcks(db, 1, '2026-10-01', '2026-10-31').map(ack => ack.signature)).toEqual(['120'])
  })

  it('refuses malformed keys', () => {
    expect(errorCode(() => acknowledgeWarnings(db, 1, leitung, [item('nonsense')], at))).toBe('invalid_warning_key')
    expect(errorCode(() => acknowledgeWarnings(db, 1, leitung, [item('made_up|2026-10-05|1')], at))).toBe('invalid_warning_key')
    expect(errorCode(() => acknowledgeWarnings(db, 1, leitung, [item('missing_entry|2026-02-30|1')], at))).toBe('invalid_warning_key')
    expect(errorCode(() => acknowledgeWarnings(db, 1, leitung, [item('staffing|2026-10-05|Bären')], at))).toBe('invalid_warning_key')
    expect(errorCode(() => acknowledgeWarnings(db, 1, leitung, [item('target_gap|2026-10-05|1', 'x'.repeat(101))], at)))
      .toBe('invalid_warning_key')
    expect(loadWarningAcks(db, 1, '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('gives the plan each person\'s weekdays off, so a part-timer\'s run of warnings is not broken', () => {
    const carla = addEmployee(db, 'Carla', { weeklyHours: 20 })
    // Mo, Di, Do, Fr: Carla does not work on Wednesdays.
    db.update(employeeHours).set({ workdays: 0b11011 }).where(eq(employeeHours.employeeId, carla)).run()
    const offDays = getMonthPlan(db, leitung, 1, 2026, 10, '2026-10-23').admin!.offDays
    expect(offDays[carla]).toEqual(['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28'])
    // Full time (Mo–Fr): no weekday off; weekends are never listed.
    expect(offDays[leitung.employeeId!]).toEqual([])
  })

  it('takes back acknowledgements of the own facility only; another facility\'s are not found', () => {
    acknowledgeWarnings(db, 1, leitung, [item('missing_entry|2026-10-05|1'), item('missing_entry|2026-10-06|1')], at)
    expect(errorCode(() => revokeWarningAcks(db, krippe, ['missing_entry|2026-10-05|1']))).toBe('warning_ack_not_found')
    expect(loadWarningAcks(db, 1, '2026-10-01', '2026-10-31')).toHaveLength(2)
    revokeWarningAcks(db, 1, ['missing_entry|2026-10-05|1'])
    expect(loadWarningAcks(db, 1, '2026-10-01', '2026-10-31').map(ack => ack.key)).toEqual(['missing_entry|2026-10-06|1'])
  })

  it('gives the acknowledgements to the plan of Leitung and Träger only, never to staff', () => {
    acknowledgeWarnings(db, 1, leitung, [item('missing_entry|2026-10-05|1')], at)
    const traeger = addUser(db, 'traeger', 'provider')
    const staff = addUser(db, 'anna', 'observer', addEmployee(db, 'Berta'))
    expect(getMonthPlan(db, leitung, 1, 2026, 10, '2026-10-23').admin!.warningAcks.map(ack => ack.key))
      .toEqual(['missing_entry|2026-10-05|1'])
    expect(getMonthPlan(db, traeger, 1, 2026, 10, '2026-10-23').admin!.warningAcks).toHaveLength(1)
    releaseMonth(db, leitung, 1, 2026, 10, at)
    expect(getMonthPlan(db, staff, 1, 2026, 10, '2026-10-23').admin).toBeNull()
  })
})
