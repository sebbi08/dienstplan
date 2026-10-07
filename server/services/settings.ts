import { and, eq } from 'drizzle-orm'
import { validateSpan, type TimeSpan } from '../../shared/domain/time'
import type { CreditMode, IsoDate, Minutes } from '../../shared/domain/types'
import type { CodeDto, ColorKey, CoverageRuleDto, SessionUser, SettingsDto, ShiftChangeResult, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, coverageRules, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { adoptShiftTimes } from './entries'
import { loadCodes, loadCoverageRules, loadTemplates } from './queries'
import { adoptShiftTimesInTemplates } from './weekTemplates'

export interface TemplateInput {
  shortLabel: string
  label: string
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
  pairsWithPrepTime: boolean
  sortOrder: number
}

export interface CodeUpdate {
  label: string
  color: ColorKey
  creditMode: CreditMode
}

export interface CoverageRuleInput {
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
  active: boolean
}

function requireLabel(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) throw new ServiceError(400, 'label_required')
  return trimmed
}

function normalizeTemplate(input: TemplateInput) {
  const label = requireLabel(input.label)
  const error = validateSpan(input)
  if (error) throw new ServiceError(400, `span_${error}`)
  return { ...input, label, shortLabel: input.shortLabel.trim() }
}

function normalizeRule(input: CoverageRuleInput) {
  const label = requireLabel(input.label)
  const invalid = input.start % 5 !== 0 || input.minCount < 1
    || (input.end !== null && (input.end % 5 !== 0 || input.end <= input.start))
  if (invalid) throw new ServiceError(400, 'invalid_rule')
  return { ...input, label }
}

const ownTemplate = (facilityId: number, id: number) =>
  and(eq(shiftTemplates.id, id), eq(shiftTemplates.facilityId, facilityId))

const ownRule = (facilityId: number, id: number) =>
  and(eq(coverageRules.id, id), eq(coverageRules.facilityId, facilityId))

export function getSettings(db: Db, facilityId: number): SettingsDto {
  return { templates: loadTemplates(db, facilityId), codes: loadCodes(db), coverageRules: loadCoverageRules(db, facilityId, false) }
}

export function createTemplate(db: Db, facilityId: number, input: TemplateInput): TemplateDto {
  return db.insert(shiftTemplates).values({ ...normalizeTemplate(input), facilityId }).returning().get()
}

export function updateTemplate(db: Db, facilityId: number, id: number, input: TemplateInput): TemplateDto {
  const row = db.update(shiftTemplates).set(normalizeTemplate(input)).where(ownTemplate(facilityId, id)).returning().get()
  if (!row) throw new ServiceError(404, 'template_not_found')
  return row
}

export function deleteTemplate(db: Db, facilityId: number, id: number): void {
  db.delete(shiftTemplates).where(ownTemplate(facilityId, id)).run()
}

export function updateCode(db: Db, id: number, update: CodeUpdate): CodeDto {
  const row = db.update(absenceCodes)
    .set({ label: requireLabel(update.label), color: update.color, creditMode: update.creditMode })
    .where(eq(absenceCodes.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'code_not_found')
  return loadCodes(db).find(code => code.id === id)!
}

export function createCoverageRule(db: Db, facilityId: number, input: CoverageRuleInput): CoverageRuleDto {
  return db.insert(coverageRules).values({ ...normalizeRule(input), facilityId }).returning().get()
}

export function updateCoverageRule(db: Db, facilityId: number, id: number, input: CoverageRuleInput): CoverageRuleDto {
  const row = db.update(coverageRules).set(normalizeRule(input)).where(ownRule(facilityId, id)).returning().get()
  if (!row) throw new ServiceError(404, 'rule_not_found')
  return row
}

export function deleteCoverageRule(db: Db, facilityId: number, id: number): void {
  db.delete(coverageRules).where(ownRule(facilityId, id)).run()
}

/**
 * Saves a service (Dienst). With applyFrom and changed times, its fixed shifts in the plan from that day on and in the
 * week templates that still have the old times get the new ones too; otherwise only new entries use the new times.
 */
export function saveTemplateChange(
  db: Db, actor: SessionUser, facilityId: number, id: number, input: TemplateInput, applyFrom: IsoDate | null,
  now: Date = new Date(),
): ShiftChangeResult {
  return db.transaction((tx) => {
    const old = tx.select().from(shiftTemplates).where(ownTemplate(facilityId, id)).get()
    const template = updateTemplate(tx, facilityId, id, input)
    const times = (span: TimeSpan): TimeSpan => ({ start: span.start, end: span.end, breakStart: span.breakStart, breakEnd: span.breakEnd })
    const changed = old && JSON.stringify(times(old)) !== JSON.stringify(times(template))
    if (!applyFrom || !old || !changed) return { template, updated: 0, skipped: 0, inTemplates: 0 }
    const result = adoptShiftTimes(tx, actor, id, times(old), times(template), applyFrom, now)
    return { template, ...result, inTemplates: adoptShiftTimesInTemplates(tx, facilityId, id, times(old), times(template)) }
  })
}
