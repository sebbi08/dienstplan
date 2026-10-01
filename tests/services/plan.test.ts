import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { deleteTemplate, updateCode } from '../../server/services/settings'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

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
  it('shows observers only the released state, not later draft edits', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    shift(ben, '2026-10-07', 'M')
    setDayNote(db, admin, '2026-10-07', 'info1', 'Elternabend')
    const plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.entries.map(e => [e.employeeId, e.date, e.shortLabel])).toEqual([[anna, '2026-10-06', 'F2']])
    expect(plan.days[6]!.info1).toBe('')
    expect(plan.changes).toEqual({})
    expect(plan.release).toMatchObject({ releasedBy: 'leitung', changeCount: 0, pendingCount: 0 })
  })
  it('does not show employees who joined after the release to observers', () => {
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    addEmployee(db, 'Dora', { validFrom: '2026-10-15' })
    expect(getMonthPlan(db, observer, 2026, 10, today).employees.map(e => e.name)).toEqual(['Anna', 'Ben'])
    expect(getMonthPlan(db, admin, 2026, 10, today).employees.map(e => e.name)).toEqual(['Anna', 'Ben', 'Dora'])
  })
  it('marks released changes and keeps them across later releases', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    setDayNote(db, admin, '2026-10-07', 'info1', 'Elternabend')
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-02T07:00:00Z'))
    const plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.changes[`${anna}|2026-10-06`]).toEqual([{
      field: 'entry', employeeId: anna, date: '2026-10-06',
      before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]',
      changedAt: '2026-10-01T07:00:00.000Z', changedBy: 'leitung',
    }])
    expect(plan.changes['info1|2026-10-07']).toEqual([expect.objectContaining({
      field: 'info1', employeeId: null, date: '2026-10-07', before: '', after: 'Elternabend', changedAt: '2026-10-02T07:00:00.000Z',
    })])
    expect(plan.release.changeCount).toBe(2)
    expect(plan.days[6]!.info1).toBe('Elternabend')
    expect(getMyPlan(db, observer, 2026, 10, today).days[5]!.changes).toHaveLength(1)
  })
  it('shows admins pending draft changes separately from released ones', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.shortLabel).toBe('S')
    expect(plan.changes).toEqual({})
    expect(plan.admin!.pendingChanges).toEqual({
      [`${anna}|2026-10-06`]: { before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]' },
    })
    expect(plan.release).toMatchObject({ changeCount: 0, pendingCount: 1 })
  })
  it('has no pending or released changes for a never-released month', () => {
    shift(anna, '2026-10-06', 'F2')
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.admin!.pendingChanges).toEqual({})
    expect(plan.release).toEqual({ releasedAt: null, releasedBy: null, changeCount: 0, pendingCount: 0 })
  })
  it('does not count a renamed code as a plan change', () => {
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    updateCode(db, codeId(db, 'sick'), { label: 'Krankheit', color: 'gray', creditMode: 'daily_target' })
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.label).toBe('Krankheit')
    expect(plan.release.pendingCount).toBe(0)
    expect(plan.admin!.pendingChanges).toEqual({})
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    expect(getMonthPlan(db, observer, 2026, 10, today).changes).toEqual({})
  })
  it('does not count a deleted template as a plan change', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    deleteTemplate(db, templateId(db, 'F2'))
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.shortLabel).toBeNull()
    expect(plan.release.pendingCount).toBe(0)
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    expect(getMonthPlan(db, observer, 2026, 10, today).changes).toEqual({})
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
