import type { Role } from '../types/api'

/**
 * „Gilt für“ of a Vorlage (Dokumente → Vorlagen) or an entry of „Wissen“: the facilities it shows in and, per facility,
 * the groups it is for.
 *
 * - A facility's own item (`facilityId` set) is for that facility only.
 * - An item of the Träger (`facilityId` null) is for all facilities (also later ones) or for the facilities chosen.
 * - In each facility it is for all groups or only for the groups chosen there.
 *
 * Who sees an item in a facility: the facility is in its scope, its visibility (and its category's) allows the role,
 * and it is for all groups there, or the viewer is Leitung or Träger, or the viewer's home group is one of the groups
 * chosen there. The tablet counts as the person who unlocked it (their home group); locked, it has none. Helpers of
 * other facilities and people without a home group therefore see only items for all groups. A facility limited to
 * groups none of which exist any more shows the item to Leitung and Träger only („keine Gruppe mehr gewählt“).
 */

/** Where an item is for: the own facility, all facilities, or the facilities chosen (Träger). */
export const DOCUMENT_SCOPES = ['facility', 'all', 'selected'] as const
export type DocumentScope = typeof DOCUMENT_SCOPES[number]

/** An item's „Gilt für“ as stored. */
export interface ItemTargets {
  allFacilities: boolean
  /** The facilities with a target row and whether they are for all groups there. */
  facilities: ReadonlyMap<number, boolean>
  /** The groups chosen, by their facility. */
  groups: ReadonlyMap<number, ReadonlySet<number>>
}

/** Who looks: the role and the home group (the employee's group; at the tablet the unlocking person's; null for none). */
export interface Audience {
  role: Role
  homeGroupId: number | null
}

/** Whether the item shows in the facility at all (before visibility and groups). */
export const inFacilityScope = (targets: ItemTargets, facilityId: number): boolean =>
  targets.allFacilities || targets.facilities.has(facilityId)

/** Whether the item is for all groups in the facility. */
export const forAllGroups = (targets: ItemTargets, facilityId: number): boolean => targets.facilities.get(facilityId) !== false

/** Leitung and Träger see items limited to groups in every group. */
export const seesAllGroups = (role: Role): boolean => role === 'admin' || role === 'provider'

/** Whether the groups the item is for in the facility allow the viewer (see the module comment). */
export function groupsAllow(targets: ItemTargets, facilityId: number, audience: Audience): boolean {
  if (forAllGroups(targets, facilityId) || seesAllGroups(audience.role)) return true
  return audience.homeGroupId !== null && (targets.groups.get(facilityId)?.has(audience.homeGroupId) ?? false)
}

/** Whether the item reaches the viewer in the facility as far as „Gilt für“ goes (the visibility comes on top). */
export const reachesAudience = (targets: ItemTargets, facilityId: number, audience: Audience): boolean =>
  inFacilityScope(targets, facilityId) && groupsAllow(targets, facilityId, audience)

/** The scope of an item as the editor sees it. */
export const scopeOf = (item: { facilityId: number | null }, targets: ItemTargets): DocumentScope =>
  (item.facilityId !== null ? 'facility' : targets.allFacilities ? 'all' : 'selected')

/** The facilities that lose an item when its facility scope changes from `before` to `after` (all = every facility). */
export function facilitiesLosing(before: 'all' | readonly number[], after: 'all' | readonly number[], every: readonly number[]): number[] {
  const set = (scope: 'all' | readonly number[]) => new Set(scope === 'all' ? every : scope)
  const kept = set(after)
  return [...set(before)].filter(id => !kept.has(id))
}

/**
 * A Träger item for chosen facilities none of which exists any more (e.g. after a facility was deleted): it shows in no
 * facility, only the Träger finds it („Keine Einrichtung gewählt“) to choose facilities again or delete it.
 */
export const isOrphan = (targets: ItemTargets): boolean => !targets.allFacilities && targets.facilities.size === 0
