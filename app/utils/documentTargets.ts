import { facilitiesLosing, type DocumentScope } from '#shared/domain/documentTargets'
import type { DocumentGroupTarget, DocumentTargetOptionsDto, DocumentTargetsDto, DocumentTargetsInput } from '#shared/types/api'

/**
 * „Gilt für“ in the forms of Vorlagen and „Wissen“ (shared/domain/documentTargets.ts): the scope, the facilities chosen
 * and the facilities limited to groups (with the groups chosen there, possibly none yet while editing).
 */
export interface TargetsForm {
  scope: DocumentScope
  facilityIds: number[]
  groupTargets: DocumentGroupTarget[]
}

/** A new item: the own facility, all groups. */
export const emptyTargets = (): TargetsForm => ({ scope: 'facility', facilityIds: [], groupTargets: [] })

/** The form of an item's „Gilt für“ as the list delivered it (a copy, to edit). */
export const targetsFormOf = (targets: DocumentTargetsDto | null): TargetsForm => (targets
  ? {
      scope: targets.scope,
      facilityIds: targets.scope === 'selected' ? [...targets.facilityIds] : [],
      groupTargets: targets.groupTargets.map(target => ({ facilityId: target.facilityId, groupIds: [...target.groupIds] })),
    }
  : emptyTargets())

/** An item of the Träger whose chosen facilities are all gone („Keine Einrichtung gewählt“): its dialog asks for one. */
export const isOrphanTargets = (targets: DocumentTargetsDto | null): boolean =>
  targets !== null && targets.scope === 'selected' && targets.facilityIds.length === 0

/** An item limited to groups in a facility that are all gone („keine Gruppe mehr gewählt“): its dialog asks for one. */
export const hasEmptyGroupLimit = (targets: DocumentTargetsDto | null): boolean =>
  targets !== null && targets.groupTargets.some(target => target.groupIds.length === 0)

/** „Gilt für“ must be filled in before the item saves (no facility or no group left): its dialog checks it like a change. */
export const targetsNeedChoice = (targets: DocumentTargetsDto | null): boolean => isOrphanTargets(targets) || hasEmptyGroupLimit(targets)

/**
 * The facilities in the scope: the own one, every facility offered, or the ones chosen; null while that is not known
 * (the choices not loaded), so nothing is dropped then.
 */
function facilitiesInScope(form: TargetsForm, options: DocumentTargetOptionsDto | null, ownFacilityId: number | null): number[] | null {
  if (form.scope === 'selected') return form.facilityIds
  if (!options) return null
  if (form.scope === 'facility') return ownFacilityId === null ? null : [ownFacilityId]
  return options.facilities.map(facility => facility.id)
}

/** The facilities whose groups the form offers to limit, in the order offered. */
export function facilitiesForGroups(options: DocumentTargetOptionsDto | null, form: TargetsForm, ownFacilityId: number | null) {
  const ids = new Set(facilitiesInScope(form, options, ownFacilityId) ?? [])
  return (options?.facilities ?? []).filter(facility => ids.has(facility.id))
}

/** Chooses a facility or takes it back (with its groups). */
export function toggleId(form: TargetsForm, facilityId: number): TargetsForm {
  const chosen = form.facilityIds.includes(facilityId)
  return {
    ...form,
    facilityIds: chosen ? form.facilityIds.filter(id => id !== facilityId) : [...form.facilityIds, facilityId],
    groupTargets: chosen ? form.groupTargets.filter(target => target.facilityId !== facilityId) : form.groupTargets,
  }
}

/** „nur bestimmte Gruppen“ (limited) or „alle Gruppen“ in the facility. */
export function setGroupLimit(form: TargetsForm, facilityId: number, limited: boolean): TargetsForm {
  const others = form.groupTargets.filter(target => target.facilityId !== facilityId)
  return { ...form, groupTargets: limited ? [...others, { facilityId, groupIds: [] }] : others }
}

/** Chooses a group of the facility or takes it back. */
export function toggleGroup(form: TargetsForm, facilityId: number, groupId: number): TargetsForm {
  return {
    ...form,
    groupTargets: form.groupTargets.map(target => (target.facilityId !== facilityId
      ? target
      : { facilityId, groupIds: target.groupIds.includes(groupId) ? target.groupIds.filter(id => id !== groupId) : [...target.groupIds, groupId] })),
  }
}

/** What is still missing before saving: a facility (chosen facilities), a group in a limited facility (its name); else null. */
export function targetsProblem(
  form: TargetsForm, options: DocumentTargetOptionsDto | null, ownFacilityId: number | null,
): { kind: 'facility' } | { kind: 'group'; facility: string } | null {
  if (form.scope === 'selected' && form.facilityIds.length === 0) return { kind: 'facility' }
  const scope = facilitiesInScope(form, options, ownFacilityId)
  const inScope = (facilityId: number) => scope === null || scope.includes(facilityId)
  const empty = form.groupTargets.find(target => inScope(target.facilityId) && target.groupIds.length === 0)
  if (!empty) return null
  return { kind: 'group', facility: options?.facilities.find(facility => facility.id === empty.facilityId)?.name ?? '' }
}

/** „Gilt für“ as sent: groups only for facilities in the scope (all of them while the scope is not known). */
export function targetsPayload(form: TargetsForm, options: DocumentTargetOptionsDto | null, ownFacilityId: number | null): Required<DocumentTargetsInput> {
  const scope = facilitiesInScope(form, options, ownFacilityId)
  return {
    scope: form.scope,
    facilityIds: form.scope === 'selected' ? form.facilityIds : [],
    groupTargets: form.groupTargets.filter(target => (scope === null || scope.includes(target.facilityId)) && target.groupIds.length > 0),
  }
}

/**
 * How many facilities would no longer show the item after the change (to ask before saving): those of its scope before
 * that are not in the new one.
 */
export function facilitiesLost(
  before: DocumentTargetsDto | null, form: TargetsForm, options: DocumentTargetOptionsDto | null, ownFacilityId: number | null,
): number {
  if (!before || !options) return 0
  const every = options.facilities.map(facility => facility.id)
  const old = before.scope === 'all' ? 'all' as const : before.facilityIds
  const now = form.scope === 'all' ? 'all' as const : form.scope === 'facility' ? (ownFacilityId === null ? [] : [ownFacilityId]) : form.facilityIds
  return facilitiesLosing(old, now, every).length
}

/**
 * The hints at an item for Leitung and Träger: „nur Kita A, Kita B“ (chosen facilities) or that none of them is left,
 * „nur Bären, Füchse“ (groups in this facility) or that no group is left.
 */
export function targetHints(
  targets: DocumentTargetsDto | null, texts: { only: (names: string[]) => string; noGroup: string; noFacility: string },
): string[] {
  if (!targets) return []
  return [
    ...(targets.scope === 'selected' ? [targets.facilityNames.length > 0 ? texts.only(targets.facilityNames) : texts.noFacility] : []),
    ...(targets.groupNames === null ? [] : targets.groupNames.length === 0 ? [texts.noGroup] : [texts.only(targets.groupNames)]),
  ]
}
