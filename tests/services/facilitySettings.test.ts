import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { activeTrackingFrom, getAppSettings, getTimeTrackingFrom, setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells, resolveEntry } from '../../server/services/entries'
import { loadCoverageRules, loadTemplates } from '../../server/services/queries'
import {
  createCoverageRule, createTemplate, deleteCoverageRule, deleteTemplate, getSettings, saveTemplateChange,
  updateCoverageRule, updateTemplate,
} from '../../server/services/settings'
import { stamp } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const input = { shortLabel: 'M', label: 'Mittel neu', start: 480, end: 975, breakStart: 700, breakEnd: 730, countsAsStaff: true, pairsWithPrepTime: true, sortOrder: 3 }
const rule = { label: 'Mitteldienst', start: 465, end: 960, minCount: 1, active: true }

describe('facility-bound settings and catalogues', () => {
  let db: Db
  let facility2: number
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    facility2 = addFacility(db, 'Krippe')
    admin = addUser(db, 'leitung', 'admin')
  })

  it('keeps shift templates and coverage rules per facility', () => {
    const copy = templateId(db, 'M', facility2)
    expect(copy).not.toBe(templateId(db, 'M'))
    expect(getSettings(db, facility2).templates.map(t => t.id)).toContain(copy)
    expect(getSettings(db, 1).templates.map(t => t.id)).not.toContain(copy)
    expect(errorCode(() => updateTemplate(db, 1, copy, input))).toBe('template_not_found')
    expect(errorCode(() => saveTemplateChange(db, admin, 1, copy, input, null))).toBe('template_not_found')
    deleteTemplate(db, 1, copy)
    expect(loadTemplates(db, facility2).map(t => t.id)).toContain(copy)
    expect(updateTemplate(db, facility2, copy, input)).toMatchObject({ label: 'Mittel neu' })
    expect(loadTemplates(db, 1).find(t => t.id === templateId(db, 'M'))!.label).not.toBe('Mittel neu')
  })
  it('keeps coverage rules per facility', () => {
    const created = createCoverageRule(db, facility2, rule)
    expect(loadCoverageRules(db, 1, false).map(r => r.id)).not.toContain(created.id)
    expect(getSettings(db, facility2).coverageRules.map(r => r.id)).toContain(created.id)
    expect(getSettings(db, 1).coverageRules).toHaveLength(3)
    expect(errorCode(() => updateCoverageRule(db, 1, created.id, rule))).toBe('rule_not_found')
    deleteCoverageRule(db, 1, created.id)
    expect(loadCoverageRules(db, facility2, false).map(r => r.id)).toContain(created.id)
  })
  it('creates templates in the given facility only', () => {
    const before = loadTemplates(db, 1).length
    const created = createTemplate(db, facility2, { ...input, shortLabel: 'X' })
    expect(loadTemplates(db, 1)).toHaveLength(before)
    expect(loadTemplates(db, facility2).map(t => t.id)).toContain(created.id)
  })
  it('time tracking starts per facility', () => {
    setTimeTrackingFrom(db, facility2, '2026-10-01')
    expect(getTimeTrackingFrom(db, 1)).toBeNull()
    expect(getTimeTrackingFrom(db, facility2)).toBe('2026-10-01')
    expect(activeTrackingFrom(db, 1, '2026-10-05')).toBeNull()
    expect(activeTrackingFrom(db, facility2, '2026-10-05')).toBe('2026-10-01')
    expect(getAppSettings(db, facility2).timeTrackingFrom).toBe('2026-10-01')
    expect(getAppSettings(db, 1).timeTrackingFrom).toBeNull()
    setTimeTrackingFrom(db, facility2, null)
    expect(getTimeTrackingFrom(db, facility2)).toBeNull()
  })
  it('stamping follows the time tracking start of the employee facility', () => {
    const anna = addEmployee(db, 'Anna')
    const berta = addEmployee(db, 'Berta', { facilityId: facility2 })
    setTimeTrackingFrom(db, 1, '2026-10-01')
    const now = new Date('2026-10-06T05:45:00Z')
    expect(stamp(db, anna, 'in', 'self', now)).toMatchObject({ employeeId: anna })
    expect(errorCode(() => stamp(db, berta, 'in', 'self', now))).toBe('time_tracking_off')
  })
  it('entries only accept the facility\'s own templates', () => {
    const other = templateId(db, 'F1', facility2)
    expect(errorCode(() => resolveEntry(db, 1, { kind: 'shift', templateId: other }))).toBe('template_not_found')
    expect(resolveEntry(db, facility2, { kind: 'shift', templateId: other })).toMatchObject({ shiftTemplateId: other })
    const anna = addEmployee(db, 'Anna')
    expect(errorCode(() => applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-05' }], 'replace', { kind: 'shift', templateId: other })))
      .toBe('template_not_found')
  })
})
