import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { weekTemplateUses } from '../../server/db/schema'
import { applyToCells, deleteEntry } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import { applyWeekTemplate, createWeekTemplate, deleteWeekTemplate } from '../../server/services/weekTemplates'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, templateId } from '../helpers/fixtures'

// 2026-10-12 is a Monday; the week lies in October.
const monday = '2026-10-12'
const today = '2026-10-01'

describe('which week template was applied to a plan week', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })
  const template = (name: string, employeeId: number, weekday = 0) =>
    createWeekTemplate(db, 1, { name, groupId: null, entries: [{ employeeId, weekday, kind: 'shift', templateId: templateId(db, 'F1') }] })
  const week = () => getMonthPlan(db, admin, 1, 2026, 10, today).admin!.weeks.find(w => w.weekStart === monday)!

  it('records each apply with the template\'s name, when and by whom; the latest first; the apply itself is no change', () => {
    const a = template('Woche A', anna)
    const b = template('Woche B', ben, 1)
    expect(week()).toMatchObject({ templateUses: [], templateChangedSince: false })
    applyWeekTemplate(db, admin, 1, a.id, monday, new Date('2026-10-01T08:00:00.000Z'))
    expect(week()).toMatchObject({
      templateUses: [{ templateName: 'Woche A', appliedAt: '2026-10-01T08:00:00.000Z', appliedBy: 'leitung' }],
      templateChangedSince: false,
    })
    applyWeekTemplate(db, admin, 1, b.id, monday, new Date('2026-10-02T09:30:00.000Z'))
    expect(week().templateUses.map(use => use.templateName)).toEqual(['Woche B', 'Woche A'])
    expect(week().templateChangedSince).toBe(false)
    // Other weeks have none.
    expect(getMonthPlan(db, admin, 1, 2026, 10, today).admin!.weeks.filter(w => w.templateUses.length > 0).map(w => w.weekStart))
      .toEqual([monday])
  })

  it('does not record an apply that fills nothing (every day already planned)', () => {
    const a = template('Woche A', anna)
    applyToCells(db, admin, 1, [{ employeeId: anna, date: monday }], 'replace', { kind: 'shift', templateId: templateId(db, 'S') })
    expect(applyWeekTemplate(db, admin, 1, a.id, monday)).toEqual({ filled: 0, skipped: 1, infosKept: [] })
    expect(week().templateUses).toEqual([])
  })

  it('flags the week once anything of its plan is entered, changed or deleted after the latest apply', () => {
    const a = template('Woche A', anna)
    applyWeekTemplate(db, admin, 1, a.id, monday)
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-10-14' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(week().templateChangedSince).toBe(true)
    // Applying again starts over from the week as it is now.
    applyWeekTemplate(db, admin, 1, template('Woche C', ben, 4).id, monday)
    expect(week().templateChangedSince).toBe(false)
    // A deleted entry counts as a change too.
    const filled = getMonthPlan(db, admin, 1, 2026, 10, today).entries.find(e => e.employeeId === anna && e.date === monday)!
    deleteEntry(db, admin, 1, filled.id)
    expect(week().templateChangedSince).toBe(true)
    // A change in another week leaves this one alone.
    applyWeekTemplate(db, admin, 1, a.id, monday)
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-10-20' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(week().templateChangedSince).toBe(false)
  })

  it('keeps the name when the template is deleted', () => {
    const a = template('Woche A', anna)
    applyWeekTemplate(db, admin, 1, a.id, monday)
    deleteWeekTemplate(db, 1, a.id)
    expect(week().templateUses.map(use => use.templateName)).toEqual(['Woche A'])
    expect(db.select().from(weekTemplateUses).all()).toEqual([expect.objectContaining({ templateId: null, templateName: 'Woche A' })])
  })

  it('is never in the released plan of the staff or at the tablet', () => {
    const observer = addUser(db, 'anna', 'observer', anna)
    const tablet = addUser(db, 'tablet', 'terminal')
    applyWeekTemplate(db, admin, 1, template('Woche A', anna).id, monday)
    releaseMonth(db, admin, 1, 2026, 10)
    for (const viewer of [observer, tablet]) {
      const plan = getMonthPlan(db, viewer, 1, 2026, 10, today)
      expect(plan.admin).toBeNull()
      expect(JSON.stringify(plan)).not.toContain('Woche A')
    }
  })
})
