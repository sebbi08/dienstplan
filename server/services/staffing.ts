import { and, eq, isNotNull, notInArray } from 'drizzle-orm'
import { todayIso } from '../../shared/domain/dates'
import { hasPeriodCheck, ruleSetProblems } from '../../shared/domain/staffing/calc'
import { applyOverrides, overridableValues, type StaffingOverrides } from '../../shared/domain/staffing/overrides'
import { presetFor, presetVersions } from '../../shared/domain/staffing/presets'
import type { StaffingRuleSet } from '../../shared/domain/staffing/types'
import type { GermanState } from '../../shared/domain/states'
import type { IsoDate } from '../../shared/domain/types'
import type { SessionUser, StaffingSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, groups, staffingOverrides } from '../db/schema'
import { ServiceError } from '../lib/errors'

/** The facility's state (Bundesland), whose preset applies. */
function facilityState(db: Db, facilityId: number): GermanState {
  const row = db.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row.state
}

const isStoredOverride = (value: unknown): value is { value: number; preset: number } =>
  typeof value === 'object' && value !== null
  && typeof (value as { value?: unknown }).value === 'number' && typeof (value as { preset?: unknown }).preset === 'number'

/** The Träger's stored overrides of the facility (empty = the preset as it is); malformed entries are skipped. */
export function loadStaffingOverrides(db: Db, facilityId: number): StaffingOverrides {
  const row = db.select({ overrides: staffingOverrides.overrides }).from(staffingOverrides)
    .where(eq(staffingOverrides.facilityId, facilityId)).get()
  if (!row) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(row.overrides)
  }
  catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isStoredOverride(value))) as StaffingOverrides
}

function storeOverrides(db: Db, facilityId: number, overrides: StaffingOverrides, actor: SessionUser | null, now: Date): void {
  if (Object.keys(overrides).length === 0) {
    db.delete(staffingOverrides).where(eq(staffingOverrides.facilityId, facilityId)).run()
    return
  }
  const values = { overrides: JSON.stringify(overrides), updatedAt: now.toISOString(), updatedBy: actor?.id ?? null }
  db.insert(staffingOverrides).values({ facilityId, ...values })
    .onConflictDoUpdate({ target: staffingOverrides.facilityId, set: values }).run()
}

export interface EffectiveStaffingRules {
  /** The rules that count: the preset of the date with the overrides that apply to it. */
  rules: StaffingRuleSet
  /** The state's preset version valid on the date. */
  preset: StaffingRuleSet
  /** Paths of the overrides that changed a value. */
  applied: string[]
  /** Paths of stored overrides that do not apply to this version (see applyOverrides). */
  ignored: string[]
}

/**
 * The preset version valid on `date` with the overrides applied. Should the overrides make that version unusable
 * (only possible for a version they were not checked against), the plain preset counts and every override is ignored.
 */
function effectiveRules(state: GermanState, date: IsoDate, overrides: StaffingOverrides): EffectiveStaffingRules {
  const preset = presetFor(state, date)
  const result = applyOverrides(preset, overrides)
  if (ruleSetProblems(result.rules).length > 0) {
    return { rules: preset, preset, applied: [], ignored: Object.keys(overrides) }
  }
  return { ...result, preset }
}

/** The staffing rules of a facility on a date (for the month: its first day). */
export function staffingRulesFor(db: Db, facilityId: number, date: IsoDate): EffectiveStaffingRules {
  return effectiveRules(facilityState(db, facilityId), date, loadStaffingOverrides(db, facilityId))
}

/** Einstellungen → Personalschlüssel for Leitung (read-only) and Träger. */
export function getStaffingSettings(
  db: Db, viewer: SessionUser, facilityId: number, today: IsoDate = todayIso(),
): StaffingSettingsDto {
  const state = facilityState(db, facilityId)
  const overrides = loadStaffingOverrides(db, facilityId)
  const { rules, preset, applied, ignored } = effectiveRules(state, today, overrides)
  const effective = new Map(overridableValues(rules).map(v => [v.path, v.value]))
  const overridden = new Set(applied)
  return {
    land: state,
    validFrom: preset.validFrom,
    source: preset.source,
    confidence: preset.confidence,
    note: preset.note ?? null,
    method: preset.method,
    periodCheck: hasPeriodCheck(preset),
    preset,
    effective: rules,
    values: overridableValues(preset).map(({ path, value }) => ({
      path, preset: value, value: effective.get(path) ?? value, overridden: overridden.has(path),
    })),
    overrides: Object.fromEntries(Object.entries(overrides).map(([path, override]) => [path, override.value])),
    ignored,
    versions: presetVersions(state).map(v => ({ validFrom: v.validFrom, source: v.source, confidence: v.confidence })),
    canEdit: viewer.role === 'provider',
  }
}

function assertProvider(actor: SessionUser): void {
  if (actor.role !== 'provider') throw new ServiceError(403, 'forbidden')
}

/**
 * The overrides must leave the version valid today and every later version usable (ruleSetProblems empty);
 * otherwise 400 staffing_rules_invalid with the first problem (and the version's validFrom) as detail.
 */
function assertUsable(state: GermanState, overrides: StaffingOverrides, today: IsoDate): void {
  const current = presetFor(state, today)
  const checked = [current, ...presetVersions(state).filter(v => v.validFrom > current.validFrom)]
  for (const version of checked) {
    const problems = ruleSetProblems(applyOverrides(version, overrides).rules)
    if (problems.length > 0) {
      throw new ServiceError(400, 'staffing_rules_invalid', { problem: problems[0], validFrom: version.validFrom })
    }
  }
}

/**
 * The Träger replaces the facility's overrides with `values` (path → number; left out = the preset). Every path must
 * be a value of the preset valid today and every value a finite number, else 400 staffing_override_invalid (detail:
 * the path); a value equal to the preset is no override. The result must stay usable (see assertUsable). Only the
 * Träger (403 forbidden). Answers the settings afterwards.
 */
export function setStaffingOverrides(
  db: Db, actor: SessionUser, facilityId: number, values: Record<string, unknown>, today: IsoDate = todayIso(),
  now: Date = new Date(),
): StaffingSettingsDto {
  assertProvider(actor)
  const state = facilityState(db, facilityId)
  const presetValues = new Map(overridableValues(presetFor(state, today)).map(v => [v.path, v.value]))
  const overrides: StaffingOverrides = {}
  for (const [path, value] of Object.entries(values)) {
    const preset = presetValues.get(path)
    if (preset === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ServiceError(400, 'staffing_override_invalid', { path })
    }
    if (value !== preset) overrides[path] = { value, preset }
  }
  assertUsable(state, overrides, today)
  storeOverrides(db, facilityId, overrides, actor, now)
  return getStaffingSettings(db, actor, facilityId, today)
}

/**
 * „Auf Vorgabe zurücksetzen“: the Träger deletes all overrides of the facility, or (with `path`) only that one; a
 * path without an override changes nothing. What is left must stay usable (400 staffing_rules_invalid otherwise:
 * reset everything instead). Only the Träger (403 forbidden). Answers the settings afterwards.
 */
export function resetStaffingOverrides(
  db: Db, actor: SessionUser, facilityId: number, path: string | null, today: IsoDate = todayIso(), now: Date = new Date(),
): StaffingSettingsDto {
  assertProvider(actor)
  const state = facilityState(db, facilityId)
  if (path === null) {
    storeOverrides(db, facilityId, {}, actor, now)
  }
  else {
    const overrides = loadStaffingOverrides(db, facilityId)
    if (path in overrides) {
      delete overrides[path]
      assertUsable(state, overrides, today)
      storeOverrides(db, facilityId, overrides, actor, now)
    }
  }
  return getStaffingSettings(db, actor, facilityId, today)
}

/**
 * After the facility's state changed (same transaction): the overrides that apply to the new state's preset valid
 * today stay (same path, same preset value, e.g. the shares or 39 h), all others are deleted – a BW Regelgruppe value
 * means nothing in Bavaria. Should the rest not be usable, all go. Group types the new state does not know are
 * cleared, so a group never keeps a type it cannot have.
 */
export function adaptStaffingToState(
  db: Db, actor: SessionUser, facilityId: number, state: GermanState, now: Date = new Date(),
): void {
  const overrides = loadStaffingOverrides(db, facilityId)
  const preset = presetFor(state, todayIso(now))
  const { applied } = applyOverrides(preset, overrides)
  let kept: StaffingOverrides = Object.fromEntries(applied.map(path => [path, overrides[path]!]))
  if (ruleSetProblems(applyOverrides(preset, kept).rules).length > 0) kept = {}
  if (Object.keys(kept).length !== Object.keys(overrides).length) storeOverrides(db, facilityId, kept, actor, now)

  const keys = (preset.groupTypes ?? []).map(type => type.key)
  const stale = and(eq(groups.facilityId, facilityId), isNotNull(groups.groupType),
    ...(keys.length > 0 ? [notInArray(groups.groupType, keys)] : []))
  db.update(groups).set({ groupType: null }).where(stale).run()
}

/** Whether `key` is a group type of the facility's rules valid today (null = none, always allowed). */
export function isStaffingGroupType(db: Db, facilityId: number, key: string | null, today: IsoDate = todayIso()): boolean {
  if (key === null) return true
  return (staffingRulesFor(db, facilityId, today).rules.groupTypes ?? []).some(type => type.key === key)
}
