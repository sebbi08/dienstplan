import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-01'

describe('month plan', () => {
  let db: Db
  let admin: SessionUser
  let observer: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
    addEmployee(db, 'Carl', { validFrom: '2026-11-01' })
    observer = addUser(db, 'anna', 'observer', anna)
  })
  const shift = (employeeId: number, date: string, label = 'M', now?: Date) =>
    applyToCells(db, admin, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) }, { now })

  it('gives admins the full draft plan with warnings, weeks and balances', () => {
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.employees.map(e => e.name)).toEqual(['Anna', 'Ben'])
    expect(plan.days).toHaveLength(31)
    expect(plan.days[2]).toMatchObject({ date: '2026-10-03', holidayKey: 'german_unity_day', isWeekend: true })
    expect(plan.templates).toHaveLength(5)
    expect(plan.codes).toHaveLength(9)
    expect(plan.admin!.weeks.map(w => w.weekStart)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(plan.admin!.weeks[0]!.weekNumber).toBe(40)
    expect(plan.admin!.warnings.filter(w => w.date === '2026-10-05')).toHaveLength(5)
    expect(plan.admin!.balances.map(b => b.name)).toEqual(['Anna', 'Ben'])
  })
  it('sums weeks across the year boundary', () => {
    for (const date of ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']) shift(anna, date)
    const lastWeek = getMonthPlan(db, admin, 2026, 12, today).admin!.weeks.at(-1)!
    expect(lastWeek).toMatchObject({ weekStart: '2026-12-28', weekEnd: '2027-01-03', weekNumber: 53 })
    expect(lastWeek.totals.find(t => t.employeeId === anna)).toEqual({ employeeId: anna, target: 1872, credit: 1860, delta: -12 })
  })
  it('hides drafts from observers', () => {
    expect(errorCode(() => getMonthPlan(db, observer, 2026, 10, today))).toBe('month_not_released')
    expect(errorCode(() => getMyPlan(db, observer, 2026, 10, today))).toBe('month_not_released')
  })
  it('gives observers released plans without hour data or warnings', () => {
    shift(anna, '2026-10-05')
    releaseMonth(db, admin, 2026, 10)
    const plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.admin).toBeNull()
    expect(plan.entries).toHaveLength(1)
  })
  it('tracks changes since the last release', () => {
    shift(anna, '2026-10-06', 'F2', new Date('2026-09-20T10:00:00Z'))
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S', new Date('2026-10-01T06:00:00Z'))
    let plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.release).toMatchObject({ releasedBy: 'leitung', changeCount: 1 })
    expect(plan.changes[`${anna}|2026-10-06`]).toEqual([expect.objectContaining({ before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]', changedBy: 'leitung' })])
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.release.changeCount).toBe(0)
    expect(plan.changes).toEqual({})
  })
  it('returns only the own entries in the personal plan', () => {
    shift(anna, '2026-10-05')
    shift(ben, '2026-10-05', 'S')
    releaseMonth(db, admin, 2026, 10)
    const mine = getMyPlan(db, observer, 2026, 10, today)
    expect(mine.employee.name).toBe('Anna')
    expect(mine.days.flatMap(d => d.entries).map(e => e.employeeId)).toEqual([anna])
    expect(errorCode(() => getMyPlan(db, { ...observer, employeeId: null }, 2026, 10, today))).toBe('no_employee')
  })
})
