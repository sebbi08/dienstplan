import { eq } from 'drizzle-orm'
import { validateSpan } from '../../shared/domain/time'
import type { CreditMode, Minutes } from '../../shared/domain/types'
import type { CodeDto, ColorKey, CoverageRuleDto, SettingsDto, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, coverageRules, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadCodes, loadCoverageRules, loadTemplates } from './queries'

export interface TemplateInput {
  shortLabel: string
  label: string
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
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

export function getSettings(db: Db): SettingsDto {
  return { templates: loadTemplates(db), codes: loadCodes(db), coverageRules: loadCoverageRules(db, false) }
}

export function createTemplate(db: Db, input: TemplateInput): TemplateDto {
  return db.insert(shiftTemplates).values(normalizeTemplate(input)).returning().get()
}

export function updateTemplate(db: Db, id: number, input: TemplateInput): TemplateDto {
  const row = db.update(shiftTemplates).set(normalizeTemplate(input)).where(eq(shiftTemplates.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'template_not_found')
  return row
}

export function deleteTemplate(db: Db, id: number): void {
  db.delete(shiftTemplates).where(eq(shiftTemplates.id, id)).run()
}

export function updateCode(db: Db, id: number, update: CodeUpdate): CodeDto {
  const row = db.update(absenceCodes)
    .set({ label: requireLabel(update.label), color: update.color, creditMode: update.creditMode })
    .where(eq(absenceCodes.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'code_not_found')
  return loadCodes(db).find(code => code.id === id)!
}

export function createCoverageRule(db: Db, input: CoverageRuleInput): CoverageRuleDto {
  return db.insert(coverageRules).values(normalizeRule(input)).returning().get()
}

export function updateCoverageRule(db: Db, id: number, input: CoverageRuleInput): CoverageRuleDto {
  const row = db.update(coverageRules).set(normalizeRule(input)).where(eq(coverageRules.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'rule_not_found')
  return row
}

export function deleteCoverageRule(db: Db, id: number): void {
  db.delete(coverageRules).where(eq(coverageRules.id, id)).run()
}
