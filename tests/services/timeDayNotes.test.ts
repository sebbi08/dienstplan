import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getMyTime } from '../../server/services/myTime'
import { getTimeMonth, setTimeDayNote } from '../../server/services/timeTracking'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

describe('reason notes on the admin time page', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
  })
  const note = (date: string) => getTimeMonth(db, anna, 2026, 10, '2026-10-08').days.find(day => day.date === date)!.note

  it('stores, replaces and clears the reason of one day', () => {
    expect(note('2026-10-06')).toBe('')
    setTimeDayNote(db, anna, '2026-10-06', '  Arzttermin  ')
    setTimeDayNote(db, anna, '2026-10-06', 'Ausstempeln vergessen')
    expect(note('2026-10-06')).toBe('Ausstempeln vergessen')
    expect(note('2026-10-07')).toBe('')
    setTimeDayNote(db, anna, '2026-10-06', '   ')
    expect(note('2026-10-06')).toBe('')
  })
  it('keeps reasons per employee', () => {
    const berta = addEmployee(db, 'Berta')
    setTimeDayNote(db, berta, '2026-10-06', 'Fortbildung extern')
    expect(note('2026-10-06')).toBe('')
  })
  it('rejects unknown employees', () => {
    expect(errorCode(() => setTimeDayNote(db, 999, '2026-10-06', 'x'))).toBe('employee_not_found')
  })
  it('is not shown to the employee', () => {
    setTimeTrackingFrom(db, '2026-10-01')
    setTimeDayNote(db, anna, '2026-10-06', 'Arzttermin')
    const viewer = addUser(db, 'anna', 'observer', anna)
    expect(JSON.stringify(getMyTime(db, viewer, 2026, 10, new Date('2026-10-08T08:00:00Z')))).not.toContain('Arzttermin')
  })
})
