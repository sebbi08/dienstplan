import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, weekTemplateInfos } from '../../server/db/schema'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import {
  applyWeekTemplate, createWeekTemplate, deleteWeekTemplate, getWeekTemplate, replaceWeekTemplate, saveWeekTemplate,
} from '../../server/services/weekTemplates'
import type { SessionUser, WeekTemplateEntryInput } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2026-10-05 is a Monday; 2026-10-12 the next one.
const week = '2026-10-05'
const next = '2026-10-12'
const today = '2026-10-01'

describe('Info 1 / Info 2 per weekday of a week template', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const duty = (weekday = 0): WeekTemplateEntryInput => ({ employeeId: anna, weekday, kind: 'shift', templateId: templateId(db, 'F1') })
  const days = (date: string) => getMonthPlan(db, admin, 1, 2026, 10, today).days.find(day => day.date === date)!

  it('saves the editor\'s texts (trimmed; a day with both empty is left out) and reads them with the template', () => {
    const template = createWeekTemplate(db, 1, {
      name: 'Woche A', groupId: null, entries: [duty()],
      infos: [{ weekday: 0, info1: ' Elternabend ', info2: '' }, { weekday: 2, info1: '', info2: 'Turnen' }, { weekday: 3, info1: ' ', info2: '' }],
    })
    expect(template.infos).toEqual([{ weekday: 0, info1: 'Elternabend', info2: '' }, { weekday: 2, info1: '', info2: 'Turnen' }])
    expect(getWeekTemplate(db, 1, template.id).infos).toEqual(template.infos)
    // Replacing sends them again; left out, they stay as they are.
    const changed = replaceWeekTemplate(db, 1, template.id, { name: 'Woche A', groupId: null, entries: [duty()], infos: [{ weekday: 6, info1: 'So', info2: '' }] })
    expect(changed.infos).toEqual([{ weekday: 6, info1: 'So', info2: '' }])
    expect(replaceWeekTemplate(db, 1, template.id, { name: 'Woche A', groupId: null, entries: [duty(1)] }).infos).toEqual(changed.infos)
  })

  it('refuses a weekday outside Monday–Sunday, the same weekday twice and a text longer than the plan\'s info field', () => {
    const create = (infos: { weekday: number; info1: string; info2: string }[]) =>
      errorCode(() => createWeekTemplate(db, 1, { name: 'X', groupId: null, entries: [duty()], infos }))
    expect(create([{ weekday: 7, info1: 'x', info2: '' }])).toBe('invalid_weekday')
    expect(create([{ weekday: 1, info1: 'x', info2: '' }, { weekday: 1, info1: 'y', info2: '' }])).toBe('invalid_input')
    expect(create([{ weekday: 1, info1: 'x'.repeat(201), info2: '' }])).toBe('info_too_long')
    expect(create([{ weekday: 1, info1: 'x'.repeat(200), info2: '' }])).toBeNull()
  })

  it('takes the week\'s Info 1 / Info 2 per weekday when a week is saved as a template', () => {
    applyToCells(db, admin, 1, [{ employeeId: anna, date: week }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1') })
    setDayNote(db, admin, 1, '2026-10-06', 'info1', 'Ausflug')
    setDayNote(db, admin, 1, '2026-10-10', 'info2', 'Sommerfest')
    setDayNote(db, admin, 1, next, 'info1', 'nächste Woche')
    const saved = saveWeekTemplate(db, 1, { name: 'Woche A', weekStart: week })
    expect(getWeekTemplate(db, 1, saved.id).infos).toEqual([{ weekday: 1, info1: 'Ausflug', info2: '' }, { weekday: 5, info1: '', info2: 'Sommerfest' }])
  })

  it('fills empty info fields when applied, keeps filled ones and names their days; holidays and closures get them too', () => {
    const template = createWeekTemplate(db, 1, {
      name: 'Woche A', groupId: null, entries: [duty()],
      infos: [
        { weekday: 0, info1: 'Teamsitzung', info2: 'Turnen' }, { weekday: 1, info1: 'Ausflug', info2: '' },
        { weekday: 2, info1: 'gleich', info2: '' }, { weekday: 5, info1: 'Samstag', info2: '' },
      ],
    })
    setDayNote(db, admin, 1, next, 'info2', 'Elterngespräch')
    setDayNote(db, admin, 1, '2026-10-13', 'info1', 'Fotograf')
    setDayNote(db, admin, 1, '2026-10-14', 'info1', 'gleich')
    const result = applyWeekTemplate(db, admin, 1, template.id, next)
    expect(result).toEqual({ filled: 1, skipped: 0, infosKept: [next, '2026-10-13'] })
    expect([days(next).info1, days(next).info2]).toEqual(['Teamsitzung', 'Elterngespräch'])
    expect(days('2026-10-13').info1).toBe('Fotograf')
    expect(days('2026-10-17').info1).toBe('Samstag')
    // 3 October 2026 (Tag der Deutschen Einheit) is a Saturday: the text goes there all the same (it is a note).
    expect(applyWeekTemplate(db, admin, 1, template.id, '2026-09-28').infosKept).toEqual([])
    expect(days('2026-10-03').info1).toBe('Samstag')
  })

  it('logs written infos like a manual edit in a released month', () => {
    const template = createWeekTemplate(db, 1, { name: 'Woche A', groupId: null, entries: [duty()], infos: [{ weekday: 1, info1: 'Ausflug', info2: '' }] })
    releaseMonth(db, admin, 1, 2026, 10)
    applyWeekTemplate(db, admin, 1, template.id, next)
    expect(db.select().from(changeLog).all().filter(row => row.field === 'info1'))
      .toEqual([expect.objectContaining({ date: '2026-10-13', before: '', after: 'Ausflug' })])
    expect(getMonthPlan(db, admin, 1, 2026, 10, today).release.pendingCount).toBeGreaterThan(0)
  })

  it('removes the infos with their template', () => {
    const template = createWeekTemplate(db, 1, { name: 'Woche A', groupId: null, entries: [duty()], infos: [{ weekday: 1, info1: 'x', info2: '' }] })
    deleteWeekTemplate(db, 1, template.id)
    expect(db.select().from(weekTemplateInfos).all()).toEqual([])
  })
})
