import { eq } from 'drizzle-orm'
import {
  BUNDLE_AREA_LABELS, BUNDLE_AREAS, BUNDLE_IDS, BUNDLES, RIGHTS_ROLES, bundlesDroppedWith,
  bundlesPulledBy, isBundleId, roleBundleMap, scopeFor, type BundleId, type BundleScope, type RightsRole,
} from '../../shared/domain/permissionBundles'
import { PERMISSIONS, can } from '../../shared/domain/permissions'
import type {
  RightsChangeDto, RightsDto, RoleRightsDto, SessionUser, UserRightsDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { roleBundles, userBundleOverrides, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { resolveFacilityId } from './facilities'
import { accountRights, bundleOverrideRows, roleBundleRows } from './permissions'

/**
 * The rights page (spec Rechte und Rollen Teil 2 §3, §4): the Träger sets the bundles of Leitung and Mitarbeiter per
 * role and as exceptions per person; the Leitung may only allow or take away „eintragen und Akten ändern“ for the
 * Mitarbeiter of its facility. Saving keeps the stored state consistent: switching a bundle on pulls in what it needs
 * and includes, switching one off drops what needs or includes it.
 */

type BundleMap = Map<BundleId, BundleScope | null>
type Override = { effect: 'grant' | 'revoke'; scope: BundleScope | null }

/** The one exception the Leitung (users.manage without rights.manage) may change, for Mitarbeiter of its facility. */
export const LEITUNG_EDITABLE: readonly BundleId[] = ['childrenEdit']

const PROVIDER_ONLY = PERMISSIONS.filter(permission => permission.providerOnly)
const PROVIDER_ONLY_KEYS = new Set<string>(PROVIDER_ONLY.map(permission => permission.key))

/** A role of the rights page from the address; 404 role_not_found otherwise (the Träger and the tablet are fixed). */
export function rightsRole(value: string): RightsRole {
  if (!(RIGHTS_ROLES as readonly string[]).includes(value)) throw new ServiceError(404, 'role_not_found')
  return value as RightsRole
}

/** A bundle id from a request: 400 provider_only_right for a Träger-only right, 400 unknown_bundle for anything else unknown. */
function checkedBundle(value: string): BundleId {
  if (isBundleId(value)) return value
  if (PROVIDER_ONLY_KEYS.has(value)) throw new ServiceError(400, 'provider_only_right')
  throw new ServiceError(400, 'unknown_bundle')
}

function checkedScope(value: unknown): BundleScope | null {
  if (value === undefined || value === null) return null
  if (value === 'group' || value === 'facility') return value
  throw new ServiceError(400, 'invalid_scope')
}

const roleMap = (db: Db, role: RightsRole): BundleMap => roleBundleMap(role, roleBundleRows(db, role))

function roleRights(role: RightsRole, bundles: BundleMap): RoleRightsDto {
  const defaults = roleBundleMap(role)
  const states = BUNDLE_IDS.map(id => ({
    id, enabled: bundles.has(id), scope: bundles.get(id) ?? null,
    defaultEnabled: defaults.has(id), defaultScope: defaults.get(id) ?? null,
  }))
  return {
    role, bundles: states,
    isDefault: states.every(state => state.enabled === state.defaultEnabled && state.scope === state.defaultScope),
  }
}

/** GET /api/rights: every switch with its relations, the Träger-only rights, and the settings of both roles. */
export function getRights(db: Db): RightsDto {
  return {
    areas: BUNDLE_AREAS.map(id => ({ id, label: BUNDLE_AREA_LABELS[id] })),
    bundles: BUNDLES.map(def => ({
      id: def.id, area: def.area, label: def.label, scoped: def.scoped, requires: [...def.requires], includes: [...def.includes],
    })),
    providerOnly: PROVIDER_ONLY.map(permission => ({ key: permission.key, label: permission.label })),
    roles: RIGHTS_ROLES.map(role => roleRights(role, roleMap(db, role))),
  }
}

/**
 * Makes `next` consistent after the bundles in `on` were switched on and those in `off` switched off: what the new ones
 * need or include comes along (`pull`), what needs or includes a removed one goes (`drop`). A bundle switched on that
 * needs one switched off in the same request is 400 conflicting_bundles. A pulled-in bundle with scope takes the widest
 * scope of the switched-on bundles that pull it ('facility' over 'group'; null: none of them has one, the role's default
 * then applies).
 */
function settle(
  next: BundleMap, on: ReadonlySet<BundleId>, off: ReadonlySet<BundleId>,
  pull: (id: BundleId, scope: BundleScope | null) => void, drop: (id: BundleId) => void,
): RightsChangeDto {
  const pullerScope = (id: BundleId): BundleScope | null => {
    const scopes = BUNDLE_IDS.filter(puller => on.has(puller) && bundlesPulledBy([puller]).includes(id))
      .map(puller => next.get(puller) ?? null)
    return scopes.includes('facility') ? 'facility' : scopes.includes('group') ? 'group' : null
  }
  const pulledIn: BundleId[] = []
  for (const id of bundlesPulledBy(on)) {
    if (off.has(id)) throw new ServiceError(400, 'conflicting_bundles')
    if (!next.has(id)) {
      pull(id, pullerScope(id))
      pulledIn.push(id)
    }
  }
  const dropped: BundleId[] = []
  for (const id of bundlesDroppedWith(off)) {
    if (next.has(id)) {
      drop(id)
      dropped.push(id)
    }
  }
  return { pulledIn, dropped }
}

/** Stores the role's state: one row per bundle that differs from the Grundeinstellung (none = Grundeinstellung). */
function storeRole(db: Db, role: RightsRole, bundles: BundleMap): void {
  const defaults = roleBundleMap(role)
  const rows = BUNDLE_IDS.flatMap((id) => {
    const enabled = bundles.has(id)
    const scope = bundles.get(id) ?? null
    if (enabled === defaults.has(id) && (!enabled || scope === defaults.get(id))) return []
    return [{ role, bundle: id, enabled, scope: enabled ? scope : null }]
  })
  db.transaction((tx) => {
    tx.delete(roleBundles).where(eq(roleBundles.role, role)).run()
    if (rows.length > 0) tx.insert(roleBundles).values(rows).run()
  })
}

/**
 * PUT /api/rights/roles/[role]: sets the role's switches (a bundle left out keeps its state); for every account of the
 * role from its next request on. Pulls in what a switched-on bundle needs, drops what needs a switched-off one;
 * a Träger-only right or an unknown bundle is 400 and nothing is stored.
 */
export function saveRoleRights(db: Db, role: RightsRole, input: readonly { id: string; enabled: boolean; scope?: string | null }[]): RoleRightsDto & RightsChangeDto {
  const current = roleMap(db, role)
  const next: BundleMap = new Map(current)
  const on = new Set<BundleId>()
  const off = new Set<BundleId>()
  const seen = new Set<BundleId>()
  for (const item of input) {
    const id = checkedBundle(item.id)
    const scope = checkedScope(item.scope)
    if (seen.has(id)) throw new ServiceError(400, 'duplicate_bundle')
    seen.add(id)
    if (item.enabled) {
      next.set(id, scopeFor(id, scope ?? current.get(id), role))
      if (!current.has(id)) on.add(id)
    }
    else {
      next.delete(id)
      if (current.has(id)) off.add(id)
    }
  }
  const change = settle(next, on, off, (id, scope) => next.set(id, scopeFor(id, scope, role)), id => next.delete(id))
  storeRole(db, role, next)
  return { ...roleRights(role, roleMap(db, role)), ...change }
}

/** Sets one switch of the role, with its dependencies (as PUT /api/rights/roles/[role] with that one switch). */
export function setRoleBundle(db: Db, role: RightsRole, id: BundleId, enabled: boolean): void {
  saveRoleRights(db, role, [{ id, enabled }])
}

/** POST /api/rights/roles/[role]/reset: back to the Grundeinstellung (Teil 1's rights). */
export function resetRoleRights(db: Db, role: RightsRole): RoleRightsDto {
  db.delete(roleBundles).where(eq(roleBundles.role, role)).run()
  return roleRights(role, roleMap(db, role))
}

// --- exceptions per person ------------------------------------------------------------------------------------

interface Target {
  id: number
  username: string
  role: RightsRole
  facilityId: number | null
}

/**
 * The account whose exceptions the actor reads or sets. The Träger (rights.manage): any Leitung or Mitarbeiter account
 * (400 no_rights_role for a Träger or tablet account, whose rights are fixed). The Leitung (role admin with
 * users.manage): only Mitarbeiter accounts of its facility; another account of its facility or a Träger account is 403
 * forbidden, an account of another facility 404 user_not_found. Anyone else who was given „Zugänge verwalten“ touches
 * no rights at all: 403 forbidden.
 */
function loadTarget(db: Db, actor: SessionUser, userId: number): Target {
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) throw new ServiceError(404, 'user_not_found')
  const facilityId = resolveFacilityId(db, row)
  const target = { id: row.id, username: row.username, facilityId }
  if (can(actor.permissions, 'rights.manage')) {
    if (row.role !== 'admin' && row.role !== 'observer') throw new ServiceError(400, 'no_rights_role')
    return { ...target, role: row.role }
  }
  if (actor.role !== 'admin') throw new ServiceError(403, 'forbidden')
  if (row.role !== 'provider' && (actor.facilityId === null || facilityId !== actor.facilityId)) {
    throw new ServiceError(404, 'user_not_found')
  }
  if (row.role !== 'observer') throw new ServiceError(403, 'forbidden')
  return { ...target, role: row.role }
}

function overrideMap(db: Db, userId: number): Map<BundleId, Override> {
  const result = new Map<BundleId, Override>()
  for (const row of bundleOverrideRows(db, userId)) {
    if (isBundleId(row.bundle) && (row.effect === 'grant' || row.effect === 'revoke')) {
      result.set(row.bundle, { effect: row.effect, scope: row.scope === 'group' || row.scope === 'facility' ? row.scope : null })
    }
  }
  return result
}

/** The role's bundles with the exceptions applied, before the closure (what the person was given). */
function withOverrides(role: BundleMap, overrides: ReadonlyMap<BundleId, Override>): BundleMap {
  const result: BundleMap = new Map(role)
  for (const [id, override] of overrides) {
    if (override.effect === 'grant') result.set(id, override.scope ?? role.get(id) ?? null)
    else result.delete(id)
  }
  return result
}

function userRights(db: Db, actor: SessionUser, target: Target): UserRightsDto {
  const role = roleMap(db, target.role)
  const overrides = overrideMap(db, target.id)
  const effective = accountRights(db, { id: target.id, role: target.role, facilityId: target.facilityId }).bundles
  return {
    userId: target.id,
    username: target.username,
    role: target.role,
    bundles: BUNDLE_IDS.map(id => ({
      id,
      role: { enabled: role.has(id), scope: role.get(id) ?? null },
      override: overrides.get(id) ?? null,
      effective: { enabled: effective.has(id), scope: effective.get(id) ?? null },
    })),
    editable: can(actor.permissions, 'rights.manage') ? [...BUNDLE_IDS] : [...LEITUNG_EDITABLE],
  }
}

/** GET /api/users/[id]/rights: the person's switches from the role, their exceptions and what applies. */
export function getUserRights(db: Db, actor: SessionUser, userId: number): UserRightsDto {
  return userRights(db, actor, loadTarget(db, actor, userId))
}

const sameOverride = (a: Override | undefined, b: Override | undefined) =>
  a?.effect === b?.effect && (a?.scope ?? null) === (b?.scope ?? null)

/**
 * PUT /api/users/[id]/rights: replaces the person's exceptions (one left out is removed). Switching a bundle on for the
 * person pulls in what it needs (an exception where the role lacks it), switching one off takes what needs it away
 * (a revoke where the role has it). The Leitung may change only the exception „eintragen und Akten ändern“ (own group)
 * of a Mitarbeiter of its facility; any other change is 403 forbidden, one the dependencies would cause (taking it
 * away drops a bundle the role gives) 403 rights_dependent_bundle. The own account is never a target for anyone but
 * the Träger (`loadTarget`: the Leitung's own account is no Mitarbeiter account, anyone else gets 403).
 */
export function saveUserRights(
  db: Db, actor: SessionUser, userId: number, input: readonly { bundle: string; effect: string; scope?: string | null }[],
): UserRightsDto & RightsChangeDto {
  const target = loadTarget(db, actor, userId)
  const provider = can(actor.permissions, 'rights.manage')
  const role = roleMap(db, target.role)
  // A grant stored without scope counts with the scope it applies with, so resending it is no change.
  const before = new Map<BundleId, Override>([...overrideMap(db, target.id)].map(([id, override]) => [id, override.effect === 'grant'
    ? { ...override, scope: scopeFor(id, override.scope ?? role.get(id), target.role) } : override]))
  const next = new Map<BundleId, Override>()
  for (const item of input) {
    const id = checkedBundle(item.bundle)
    const effect = item.effect
    if (effect !== 'grant' && effect !== 'revoke') throw new ServiceError(400, 'invalid_effect')
    const scope = checkedScope(item.scope)
    if (next.has(id)) throw new ServiceError(400, 'duplicate_bundle')
    next.set(id, { effect, scope: effect === 'grant' ? scopeFor(id, scope ?? role.get(id), target.role) : null })
  }
  const had = withOverrides(role, before)
  const has = withOverrides(role, next)
  const on = new Set([...has.keys()].filter(id => !had.has(id)))
  const off = new Set([...had.keys()].filter(id => !has.has(id)))
  const change = settle(has, on, off, (id, scope) => {
    const granted = scopeFor(id, scope, target.role)
    if (role.has(id) && role.get(id) === granted) next.delete(id)
    else next.set(id, { effect: 'grant', scope: granted })
    has.set(id, granted)
  }, (id) => {
    if (role.has(id)) next.set(id, { effect: 'revoke', scope: null })
    else next.delete(id)
    has.delete(id)
  })
  if (!provider) {
    const changed = BUNDLE_IDS.filter(id => !sameOverride(before.get(id), next.get(id)))
    const others = changed.filter(id => !LEITUNG_EDITABLE.includes(id))
    if (others.length > 0) {
      // Taking „eintragen und Akten ändern“ away would also take a bundle the Träger gave (role or exception).
      if (others.every(id => change.dropped.includes(id))) throw new ServiceError(403, 'rights_dependent_bundle')
      throw new ServiceError(403, 'forbidden')
    }
    // Only a change of the switch itself is checked: an unchanged exception the Träger set stays as it is.
    const childEdit = next.get('childrenEdit')
    if (changed.includes('childrenEdit') && childEdit?.effect === 'grant' && childEdit.scope !== 'group') {
      throw new ServiceError(403, 'forbidden')
    }
    // Only a Leitung that may edit records itself gives that right on (the Träger can take it from the Leitung).
    if (changed.includes('childrenEdit') && has.has('childrenEdit') && !can(actor.permissions, 'children.edit')) {
      throw new ServiceError(403, 'rights_not_held')
    }
  }
  db.transaction((tx) => {
    tx.delete(userBundleOverrides).where(eq(userBundleOverrides.userId, target.id)).run()
    const rows = [...next].map(([bundle, override]) => ({ userId: target.id, bundle, ...override }))
    if (rows.length > 0) tx.insert(userBundleOverrides).values(rows).run()
  })
  return { ...userRights(db, actor, target), ...change }
}

