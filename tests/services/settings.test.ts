import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells, updateEntryTimes } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import {
  createCoverageRule, createTemplate, deleteCoverageRule, deleteTemplate, getSettings,
  saveTemplateChange, updateCode, updateCoverageRule, updateTemplate,
} from '../../server/services/settings'
import { listWeekTemplates, saveWeekTemplate } from '../../server/services/weekTemplates'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-05'

describe('settings service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })

  it('returns the seeded settings', () => {
    const settings = getSettings(db)
    expect(settings.templates.map(t => t.shortLabel)).toEqual(['F1', 'F2', 'M', 'S', 'HK'])
    expect(settings.codes.map(c => c.key)).toEqual(['vacation', 'special_leave', 'sick', 'office', 'prep_time', 'training', 'school', 'other', 'holiday', 'closure_day'])
    expect(settings.coverageRules).toHaveLength(3)
  })
  it('does not change existing entries when a template changes or is deleted', () => {
    const m = templateId(db, 'M')
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: m })
    updateTemplate(db, m, { shortLabel: 'M', label: 'Mitteldienst', start: 480, end: 975, breakStart: 700, breakEnd: 730, countsAsStaff: true, pairsWithPrepTime: true, sortOrder: 3 })
    expect(loadEntries(db)[0]).toMatchObject({ start: 465, end: 960 })
    deleteTemplate(db, m)
    expect(loadEntries(db)[0]).toMatchObject({ start: 465, end: 960, templateId: null })
  })
  it('validates templates', () => {
    const input = { shortLabel: 'X', label: 'Test', start: 465, end: 960, breakStart: 450, breakEnd: 480, countsAsStaff: true, pairsWithPrepTime: false, sortOrder: 9 }
    expect(errorCode(() => createTemplate(db, input))).toBe('span_break_outside')
    expect(errorCode(() => createTemplate(db, { ...input, label: ' ', breakStart: null, breakEnd: null }))).toBe('label_required')
    expect(createTemplate(db, { ...input, breakStart: null, breakEnd: null })).toMatchObject({ label: 'Test' })
  })
  it('updates codes and applies the new credit mode to existing entries', () => {
    const sick = codeId(db, 'sick')
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'code', codeId: sick })
    expect(updateCode(db, sick, { label: 'Krank', color: 'red', creditMode: 'none' })).toMatchObject({ color: 'red', creditMode: 'none' })
    expect(loadEntries(db)[0]).toMatchObject({ creditMode: 'none', color: 'red' })
    expect(errorCode(() => updateCode(db, 999, { label: 'X', color: 'red', creditMode: 'none' }))).toBe('code_not_found')
  })
  it('manages coverage rules', () => {
    const input = { label: 'Mitteldienst', start: 465, end: 960, minCount: 1, active: true }
    const rule = createCoverageRule(db, input)
    expect(updateCoverageRule(db, rule.id, { ...input, active: false }).active).toBe(false)
    deleteCoverageRule(db, rule.id)
    expect(getSettings(db).coverageRules).toHaveLength(3)
    expect(errorCode(() => createCoverageRule(db, { label: 'X', start: 463, end: null, minCount: 1, active: true }))).toBe('invalid_rule')
    expect(errorCode(() => createCoverageRule(db, { label: 'X', start: 600, end: 540, minCount: 1, active: true }))).toBe('invalid_rule')
  })
})

describe('changing a service and its existing shifts', () => {
  const f1 = { shortLabel: 'F1', label: 'Frühdienst', start: 420, end: 795, countsAsStaff: true, pairsWithPrepTime: false, sortOrder: 1 }
  const withBreak = { ...f1, breakStart: 660, breakEnd: 690 }
  let db: Db
  let admin: SessionUser
  let anna: number
  let id: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    id = templateId(db, 'F1')
  })
  const enter = (dates: string[]) => applyToCells(db, admin, dates.map(d => ({ employeeId: anna, date: d })), 'replace', { kind: 'shift', templateId: id })
  const breaks = () => loadEntries(db, { employeeId: anna }).filter(e => e.kind === 'shift').map(e => [e.date, e.breakStart])

  it('gives fixed shifts from the chosen day on the new break and keeps earlier days', () => {
    enter(['2026-10-02', '2026-10-05', '2026-10-06'])
    const result = saveTemplateChange(db, admin, id, withBreak, '2026-10-05')
    expect(result).toMatchObject({ updated: 2, skipped: 0, inTemplates: 0 })
    expect(breaks()).toEqual([['2026-10-02', null], ['2026-10-05', 660], ['2026-10-06', 660]])
  })
  it('changes only new entries without a date, and keeps individually changed or clashing shifts', () => {
    enter(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(saveTemplateChange(db, admin, id, { ...f1, breakStart: null, breakEnd: null, label: 'Früh' }, '2026-10-05'))
      .toMatchObject({ updated: 0 }) // times unchanged
    const [, second, third] = loadEntries(db, { employeeId: anna })
    updateEntryTimes(db, admin, second!.id, { start: 420, end: 795, breakStart: 600, breakEnd: 630 }) // own break
    applyToCells(db, admin, [{ employeeId: anna, date: third!.date }], 'add', { kind: 'break', start: 670, end: 685 }) // extra break
    expect(saveTemplateChange(db, admin, id, withBreak, null)).toMatchObject({ updated: 0, skipped: 0 })
    expect(saveTemplateChange(db, admin, id, { ...f1, breakStart: null, breakEnd: null }, null).template.breakStart).toBeNull()
    expect(saveTemplateChange(db, admin, id, withBreak, '2026-10-01')).toMatchObject({ updated: 1, skipped: 1 })
    expect(breaks()).toEqual([['2026-10-05', 660], ['2026-10-06', 600], ['2026-10-07', null]])
  })
  it('updates the service in week templates too', () => {
    enter(['2026-10-05'])
    saveWeekTemplate(db, { name: 'A', weekStart: '2026-10-05' })
    expect(saveTemplateChange(db, admin, id, withBreak, '2026-10-12')).toMatchObject({ updated: 0, inTemplates: 1 })
    expect(listWeekTemplates(db)[0]!.rows[0]!.days[0]).toBe('F1')
  })
})
