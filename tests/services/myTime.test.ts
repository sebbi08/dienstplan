import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getMyTime } from '../../server/services/myTime'
import { stamp } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

describe('my time', () => {
  let db: Db
  let anna: number
  let viewer: SessionUser
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna', { validFrom: '2026-10-01' })
    viewer = addUser(db, 'anna', 'observer', anna)
  })
  it('is disabled without time tracking', () => {
    expect(getMyTime(db, viewer, 2026, 10, new Date('2026-10-06T08:00:00Z')).enabled).toBe(false)
  })
  it('shows today, earlier open records and the own balance', () => {
    setTimeTrackingFrom(db, '2026-10-01')
    stamp(db, anna, 'in', 'self', new Date('2026-10-05T05:42:00Z'))
    stamp(db, anna, 'in', 'self', new Date('2026-10-06T05:45:00Z'))
    const mine = getMyTime(db, viewer, 2026, 10, new Date('2026-10-06T08:00:00Z'))
    expect(mine).toMatchObject({ enabled: true, today: '2026-10-06', clockedInSince: 465, openEarlier: ['2026-10-05'] })
    expect(mine.todayRecords).toHaveLength(1)
    expect(mine.records).toHaveLength(2)
    // 01.–05.10. nothing counted (05.10. open) → 3 workdays (01., 02., 05.) × −468
    expect(mine.balanceToday).toBe(-3 * 468)
  })
  it('requires a linked employee', () => {
    const admin = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => getMyTime(db, admin, 2026, 10))).toBe('no_employee')
  })
})
