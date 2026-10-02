import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import {
  createCoverageRule, createTemplate, deleteCoverageRule, deleteTemplate, getSettings,
  updateCode, updateCoverageRule, updateTemplate,
} from '../../server/services/settings'
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
