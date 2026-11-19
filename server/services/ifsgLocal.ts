import { and, desc, eq } from 'drizzle-orm'
import { IFSG_CATALOGUE, ifsgDisease, type IfsgDisease } from '../../shared/domain/ifsg'
import {
  MAX_LOCAL_DATE_RULES, ifsgDifference, isProof, mergeIfsgRules, validLocalDateRule, type IfsgLocalDateRule,
  type IfsgLocalRule,
} from '../../shared/domain/ifsgLocal'
import { RNK_HEALTH_OFFICE, presetRules, type IfsgPresetKey } from '../../shared/domain/ifsgPresets'
import type { IfsgDocumentDto, IfsgLocalRuleInput, IfsgLocalRulesDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { childIfsgCases, facilities, ifsgDocuments, ifsgLocalRules } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { safeFileNamePart } from '../lib/fileName'
import { DOCUMENT_EXTENSIONS, checkedDocumentFile, type DocumentMime } from '../lib/fileSignature'

// The local health office's rules for the readmission (Einstellungen → Kinder → „Wiederzulassung (Gesundheitsamt)“,
// Leitung and Träger): per disease beside the RKI rule, local diseases, the presets, the health office's documents.
// `ifsgRulesFor` (ifsg.ts) merges them over the RKI catalogue.

type Row = typeof ifsgLocalRules.$inferSelect

/** The stored date rules (JSON) as a list; anything unreadable counts as none set (null). */
function parsedRules(value: string | null): IfsgLocalDateRule[] | null {
  if (value === null) return null
  try {
    const list: unknown = JSON.parse(value)
    return Array.isArray(list) ? (list as IfsgLocalDateRule[]).filter(validLocalDateRule) : null
  }
  catch {
    return null
  }
}

function toRule(row: Row): IfsgLocalRule {
  return {
    key: row.disease, custom: row.custom, name: row.name, notifiable: row.notifiable, text: row.text, rules: parsedRules(row.rules),
    proof: isProof(row.proof) ? row.proof : null, notify: row.notify, householdText: row.householdText,
    householdExclusion: row.householdExclusion, note: row.note, hint: row.hint,
  }
}

/** The facility's local rules. */
export function localRulesOf(db: Db, facilityId: number): IfsgLocalRule[] {
  return db.select().from(ifsgLocalRules).where(eq(ifsgLocalRules.facilityId, facilityId)).all().map(toRule)
}

/** The facility's health office (name and phone; empty when not set). */
export function healthOfficeOf(db: Db, facilityId: number): { name: string; phone: string } {
  const row = db.select({ name: facilities.healthOfficeName, phone: facilities.healthOfficePhone }).from(facilities)
    .where(eq(facilities.id, facilityId)).get()
  return row ?? { name: '', phone: '' }
}

/** The merged rules: the RKI catalogue with the facility's local rules over it. */
export function mergedRulesOf(db: Db, facilityId: number): IfsgDisease[] {
  return mergeIfsgRules(IFSG_CATALOGUE, localRulesOf(db, facilityId))
}

/** The settings page: the health office, and per disease the RKI rule, the local one, the merged one and what differs. */
export function localRulesOverview(db: Db, facilityId: number): IfsgLocalRulesDto {
  const locals = localRulesOf(db, facilityId)
  const merged = mergeIfsgRules(IFSG_CATALOGUE, locals)
  const used = new Set(db.selectDistinct({ disease: childIfsgCases.disease }).from(childIfsgCases)
    .where(eq(childIfsgCases.facilityId, facilityId)).all().map(row => row.disease))
  return {
    healthOffice: healthOfficeOf(db, facilityId),
    rows: merged.map((disease) => {
      const rki = ifsgDisease(IFSG_CATALOGUE, disease.key)
      return {
        key: disease.key, rki, local: locals.find(local => local.key === disease.key) ?? null, merged: disease,
        difference: ifsgDifference(rki, disease), used: used.has(disease.key),
      }
    }),
  }
}

/** The input checked: trimmed texts (empty = null), known proof, 0–3 complete date rules (400 ifsg_local_invalid). */
function checkedInput(input: IfsgLocalRuleInput): Omit<IfsgLocalRule, 'key' | 'custom'> {
  const textOf = (value: string | null | undefined) => (value === null || value === undefined || value.trim() === '' ? null : value.trim())
  if (input.proof !== null && input.proof !== undefined && !isProof(input.proof)) throw new ServiceError(400, 'ifsg_local_invalid')
  if (input.rules && (input.rules.length > MAX_LOCAL_DATE_RULES || !input.rules.every(validLocalDateRule))) {
    throw new ServiceError(400, 'ifsg_local_invalid')
  }
  return {
    name: textOf(input.name), notifiable: input.notifiable ?? null, text: textOf(input.text),
    rules: input.rules ? input.rules.map(rule => ({
      anchor: rule.anchor, days: rule.days, label: rule.label.trim(), ...(rule.condition === undefined ? {} : { condition: rule.condition.trim() }),
    })) : null,
    proof: input.proof ?? null, notify: input.notify ?? null, householdText: textOf(input.householdText),
    householdExclusion: input.householdExclusion ?? null, note: textOf(input.note), hint: textOf(input.hint),
  }
}

/** The columns of a local rule. */
const columns = (rule: Omit<IfsgLocalRule, 'key'>, now: Date) => ({
  custom: rule.custom, name: rule.name, notifiable: rule.notifiable, text: rule.text,
  rules: rule.rules === null ? null : JSON.stringify(rule.rules), proof: rule.proof, notify: rule.notify,
  householdText: rule.householdText, householdExclusion: rule.householdExclusion, note: rule.note, hint: rule.hint,
  updatedAt: now.toISOString(),
})

function upsert(db: Db, facilityId: number, rule: IfsgLocalRule, now: Date): void {
  const { key, ...rest } = rule
  db.insert(ifsgLocalRules).values({ facilityId, disease: key, ...columns(rest, now) })
    .onConflictDoUpdate({ target: [ifsgLocalRules.facilityId, ifsgLocalRules.disease], set: columns(rest, now) }).run()
}

function findRow(db: Db, facilityId: number, key: string): Row | undefined {
  return db.select().from(ifsgLocalRules).where(and(eq(ifsgLocalRules.facilityId, facilityId), eq(ifsgLocalRules.disease, key))).get()
}

/**
 * Saves the local rule of an RKI disease or of a local one (404 ifsg_disease_unknown for any other key). A local disease
 * needs its name (400 ifsg_local_name_required) and says whether it is notifiable; an RKI disease keeps no name.
 */
export function saveLocalRule(db: Db, facilityId: number, key: string, input: IfsgLocalRuleInput, now: Date = new Date()): void {
  const existing = findRow(db, facilityId, key)
  const custom = existing?.custom ?? false
  if (!custom && !ifsgDisease(IFSG_CATALOGUE, key)) throw new ServiceError(404, 'ifsg_disease_unknown')
  const checked = checkedInput(input)
  if (custom && checked.name === null) throw new ServiceError(400, 'ifsg_local_name_required')
  // The notification duty of an RKI disease stands by law (§ 34 Abs. 6): only a local disease stores its own.
  upsert(db, facilityId, {
    key, custom, ...checked, name: custom ? checked.name : null, notifiable: custom ? checked.notifiable ?? false : null,
    notify: custom ? checked.notify : null,
  }, now)
}

/** A key for a local disease from its name: letters and digits, unique in the facility and never an RKI key. */
function newKey(db: Db, facilityId: number, name: string): string {
  const base = `local_${safeFileNamePart(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'krankheit'}`.slice(0, 50)
  const taken = new Set([...IFSG_CATALOGUE.map(disease => disease.key), ...localRulesOf(db, facilityId).map(rule => rule.key)])
  let key = base
  for (let suffix = 2; taken.has(key); suffix++) key = `${base}_${suffix}`
  return key
}

/** A new local disease (400 ifsg_local_name_required without a name; a name in use: 409 ifsg_local_name_taken). Returns its key. */
export function addLocalDisease(db: Db, facilityId: number, input: IfsgLocalRuleInput, now: Date = new Date()): string {
  const checked = checkedInput(input)
  if (checked.name === null) throw new ServiceError(400, 'ifsg_local_name_required')
  const same = (a: string) => a.localeCompare(checked.name!, 'de', { sensitivity: 'accent' }) === 0
  if (mergedRulesOf(db, facilityId).some(disease => same(disease.name))) throw new ServiceError(409, 'ifsg_local_name_taken')
  const key = newKey(db, facilityId, checked.name)
  upsert(db, facilityId, { key, custom: true, ...checked, notifiable: checked.notifiable ?? false }, now)
  return key
}

/** A disease name compared without case, umlauts, spaces and punctuation („COVID-19“ = „Covid 19“). */
function normalizedName(name: string): string {
  return safeFileNamePart(name).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Removes a local rule: an RKI disease follows the RKI again; a local disease is gone, unless a case uses it (409
 * ifsg_local_in_use). 404 ifsg_local_not_found without a row.
 */
export function deleteLocalRule(db: Db, facilityId: number, key: string): void {
  const row = findRow(db, facilityId, key)
  if (!row) throw new ServiceError(404, 'ifsg_local_not_found')
  if (row.custom && db.select({ id: childIfsgCases.id }).from(childIfsgCases)
    .where(and(eq(childIfsgCases.facilityId, facilityId), eq(childIfsgCases.disease, key))).get()) {
    throw new ServiceError(409, 'ifsg_local_in_use')
  }
  db.delete(ifsgLocalRules).where(eq(ifsgLocalRules.id, row.id)).run()
}

/**
 * Applies a preset: „RKI-Werte übernehmen“ or the Rhein-Neckar-Kreis document. Existing local rows of the preset's keys
 * are overwritten only with `overwrite` (409 ifsg_local_exists otherwise, nothing changed); other local diseases stay.
 * A local disease of the preset whose name another local disease already has (e.g. a „COVID-19“ added by hand) is
 * left out, so no name appears twice.
 * The Rhein-Neckar-Kreis preset fills the health office's name and phone while they are empty. Returns the rows written.
 */
export function applyIfsgPreset(db: Db, facilityId: number, preset: IfsgPresetKey, overwrite: boolean, now: Date = new Date()): number {
  const current = localRulesOf(db, facilityId)
  const existing = new Set(current.map(rule => rule.key))
  const takenNames = new Map(current.filter(rule => rule.custom && rule.name).map(rule => [normalizedName(rule.name!), rule.key]))
  const rows = presetRules(preset).filter((rule) => {
    const owner = rule.custom && rule.name ? takenNames.get(normalizedName(rule.name)) : undefined
    return owner === undefined || owner === rule.key
  })
  if (!overwrite && rows.some(rule => existing.has(rule.key))) throw new ServiceError(409, 'ifsg_local_exists')
  db.transaction((tx) => {
    for (const rule of rows) upsert(tx, facilityId, rule, now)
    if (preset === 'rnk_2024') {
      const office = healthOfficeOf(tx, facilityId)
      tx.update(facilities).set({
        healthOfficeName: office.name || RNK_HEALTH_OFFICE.name, healthOfficePhone: office.phone || RNK_HEALTH_OFFICE.phone,
      }).where(eq(facilities.id, facilityId)).run()
    }
  })
  return rows.length
}


// ---- the health office's documents ----

const DOCUMENT_COLUMNS = {
  id: ifsgDocuments.id, title: ifsgDocuments.title, mimeType: ifsgDocuments.mimeType, size: ifsgDocuments.size,
  uploadedAt: ifsgDocuments.uploadedAt,
}

/** The facility's health office documents, newest first (every child viewer reads them, also at the tablet). */
export function listIfsgDocuments(db: Db, facilityId: number): IfsgDocumentDto[] {
  return db.select(DOCUMENT_COLUMNS).from(ifsgDocuments).where(eq(ifsgDocuments.facilityId, facilityId))
    .orderBy(desc(ifsgDocuments.uploadedAt), desc(ifsgDocuments.id)).all()
}

/** A new document (PDF/JPG/PNG, as every document; the detected type is stored). Returns its id. */
export function uploadIfsgDocument(
  db: Db, actor: { id: number | null; facilityId: number }, title: string, file: { data: Buffer }, now: Date = new Date(),
): number {
  const mimeType = checkedDocumentFile(file.data)
  return db.insert(ifsgDocuments).values({
    facilityId: actor.facilityId, title: title.trim(), mimeType, size: file.data.length, data: file.data, uploadedBy: actor.id,
    uploadedAt: now.toISOString(),
  }).returning({ id: ifsgDocuments.id }).get().id
}

/** The file with its stored type; another facility's or an unknown one: 404 document_not_found. */
export function readIfsgDocument(db: Db, facilityId: number, id: number): { data: Buffer; mimeType: string; fileName: string } {
  const row = db.select().from(ifsgDocuments).where(and(eq(ifsgDocuments.id, id), eq(ifsgDocuments.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'document_not_found')
  const extension = DOCUMENT_EXTENSIONS[row.mimeType as DocumentMime] ?? 'bin'
  return { data: row.data, mimeType: row.mimeType, fileName: `${safeFileNamePart(row.title) || 'Gesundheitsamt'}.${extension}` }
}

export function deleteIfsgDocument(db: Db, facilityId: number, id: number): void {
  readIfsgDocument(db, facilityId, id)
  db.delete(ifsgDocuments).where(eq(ifsgDocuments.id, id)).run()
}
