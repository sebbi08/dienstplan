import {
  BUNDLE_AREA_LABELS, BUNDLE_IDS, BUNDLES, DEFAULT_SCOPE, bundleDef, bundlesDroppedWith, bundlesPulledBy, effectiveRights,
  type BundleId, type BundleScope, type RightsRole,
} from '#shared/domain/permissionBundles'
import type { PermissionKey } from '#shared/domain/permissions'
import type {
  Role, RoleRightsDto, RoleRightsInput, UserBundleStateDto, UserRightsDto, UserRightsInput,
} from '#shared/types/api'

/**
 * The client side of the rights page and the exceptions block (spec Rechte und Rollen Teil 2 §3, §4): a role's switches
 * as an editable draft, what switching one on brings along and what switching one off takes away (the same relations the
 * server applies when saving), and the person's exceptions as the complete list the rights API takes.
 */

/** One switch of a role in the draft. */
export interface BundleState {
  enabled: boolean
  /** Only for a scoped bundle that is on. */
  scope: BundleScope | null
}
export type RoleDraft = Record<BundleId, BundleState>

/** The name of a switch with its area, for hints and questions („Dienstplan: ansehen“). */
export function bundleTitle(id: BundleId): string {
  const def = bundleDef(id)
  return `${BUNDLE_AREA_LABELS[def.area]}: ${def.label}`
}

/** The names of the switches, joined for a sentence. */
export const bundleTitles = (ids: readonly BundleId[]): string => ids.map(bundleTitle).join(', ')

/** The switches that include this one (the page's „enthalten in: …“). */
export function includedIn(id: BundleId): BundleId[] {
  return BUNDLES.filter(def => def.includes.includes(id)).map(def => def.id)
}

/** The role's stored switches as a draft. */
export function roleDraft(rights: RoleRightsDto): RoleDraft {
  const draft = {} as RoleDraft
  for (const id of BUNDLE_IDS) draft[id] = { enabled: false, scope: null }
  for (const state of rights.bundles) draft[state.id] = { enabled: state.enabled, scope: state.enabled ? state.scope : null }
  return draft
}

const scoped = (id: BundleId) => bundleDef(id).scoped

/**
 * Switches the bundle on with what it needs and includes (spec §3 „Setzen zieht Voraussetzungen mit“). A switched-on
 * scoped bundle gets the role's default scope; one pulled in takes the scope of the bundle that pulls it (else the
 * default), as the server does. `pulledIn` = the bundles that were off and come along.
 */
export function switchOn(draft: RoleDraft, id: BundleId, role: RightsRole): { draft: RoleDraft; pulledIn: BundleId[] } {
  if (draft[id].enabled) return { draft, pulledIn: [] }
  const next = { ...draft }
  const scope = scoped(id) ? DEFAULT_SCOPE[role] : null
  next[id] = { enabled: true, scope }
  const pulledIn = bundlesPulledBy([id]).filter(other => !draft[other].enabled)
  for (const other of pulledIn) next[other] = { enabled: true, scope: scoped(other) ? (scope ?? DEFAULT_SCOPE[role]) : null }
  return { draft: next, pulledIn }
}

/** What switching the bundle off would take away as well (spec §3 „Dann entfällt auch: …“): the dependents that are on. */
export function dropPreview(draft: RoleDraft, id: BundleId): BundleId[] {
  return bundlesDroppedWith([id]).filter(other => draft[other].enabled)
}

/** Switches the bundle off with every switch that needs or includes it. */
export function switchOff(draft: RoleDraft, id: BundleId): { draft: RoleDraft; dropped: BundleId[] } {
  if (!draft[id].enabled) return { draft, dropped: [] }
  const dropped = dropPreview(draft, id)
  const next = { ...draft }
  for (const other of [id, ...dropped]) next[other] = { enabled: false, scope: null }
  return { draft: next, dropped }
}

/** Sets the scope of a scoped bundle that is on. */
export function withScope(draft: RoleDraft, id: BundleId, scope: BundleScope): RoleDraft {
  if (!draft[id].enabled || !scoped(id)) return draft
  return { ...draft, [id]: { enabled: true, scope } }
}

/** The switches of the draft that differ from the stored state: the body of PUT /api/rights/roles/[role]. */
export function changedBundles(draft: RoleDraft, stored: RoleDraft): RoleRightsInput['bundles'] {
  return BUNDLE_IDS.filter(id => draft[id].enabled !== stored[id].enabled || draft[id].scope !== stored[id].scope)
    .map(id => (draft[id].enabled && scoped(id) ? { id, enabled: true, scope: draft[id].scope } : { id, enabled: draft[id].enabled }))
}

// --- exceptions per person --------------------------------------------------------------------------------------

/**
 * Which rights of an account the viewer sees and changes (spec §4): the Träger every switch of a Leitung or Mitarbeiter
 * account; the Leitung only „eintragen und Akten ändern“ of a Mitarbeiter account (the server limits it to the
 * Mitarbeiter of its facility); nobody else, and nobody the rights of a Träger or tablet account. `targetRole` is the
 * stored role of the account.
 */
export function personRightsMode(
  viewer: { role: Role | undefined; can: (key: PermissionKey) => boolean }, targetRole: Role,
): 'all' | 'childrenEdit' | null {
  if (targetRole !== 'admin' && targetRole !== 'observer') return null
  if (viewer.can('rights.manage')) return 'all'
  if (viewer.role === 'admin' && targetRole === 'observer' && viewer.can('users.manage')) return 'childrenEdit'
  return null
}

/** How a person's switch stands: as the role has it, granted on top of it, or taken away. */
export type ExceptionChoice = 'role' | 'grant' | 'revoke'

export function exceptionChoice(bundle: UserBundleStateDto): ExceptionChoice {
  return bundle.override?.effect ?? 'role'
}

/** The person's exceptions as stored, the body shape of PUT /api/users/[id]/rights. */
export function currentOverrides(rights: UserRightsDto): UserRightsInput['overrides'] {
  return rights.bundles.filter(bundle => bundle.override !== null)
    .map(bundle => ({ bundle: bundle.id, effect: bundle.override!.effect, scope: bundle.override!.scope }))
}

/**
 * The complete list of exceptions with the one for `id` replaced: 'role' removes it, 'grant' allows the switch (scoped
 * bundles with the given scope, else the role's scope or default), 'revoke' takes it away.
 */
export function overridesWith(
  rights: UserRightsDto, id: BundleId, choice: ExceptionChoice, scope: BundleScope | null = null,
): UserRightsInput['overrides'] {
  const others = currentOverrides(rights).filter(override => override.bundle !== id)
  if (choice === 'role') return others
  if (choice === 'revoke') return [...others, { bundle: id, effect: 'revoke', scope: null }]
  const bundle = rights.bundles.find(state => state.id === id)
  const grantScope = scoped(id) ? (scope ?? bundle?.role.scope ?? DEFAULT_SCOPE[rights.role]) : null
  return [...others, { bundle: id, effect: 'grant', scope: grantScope }]
}

/**
 * The Leitung's one switch, „eintragen und Akten ändern“ for a Mitarbeiter (formerly „darf Kinderakten pflegen“): an
 * exception only where the role does not already give what is wanted, allowed for the own group.
 */
export function childEditingOverrides(rights: UserRightsDto, allowed: boolean): UserRightsInput['overrides'] {
  const fromRole = rights.bundles.find(bundle => bundle.id === 'childrenEdit')?.role.enabled ?? false
  if (allowed === fromRole) return overridesWith(rights, 'childrenEdit', 'role')
  return overridesWith(rights, 'childrenEdit', allowed ? 'grant' : 'revoke', 'group')
}

/** The bundles in effect for the person with these exceptions (the role's state from the answer, the resolver's rules). */
export function effectiveWith(rights: UserRightsDto, overrides: UserRightsInput['overrides']): Set<BundleId> {
  const roleBundles = rights.bundles.map(bundle => ({ bundle: bundle.id, enabled: bundle.role.enabled, scope: bundle.role.scope }))
  const parsed = overrides.map(override => ({ bundle: override.bundle, effect: override.effect, scope: override.scope ?? null }))
  return new Set(effectiveRights({ role: rights.role, roleBundles, overrides: parsed }).bundles.keys())
}

/**
 * What the new exceptions would take away beyond the changed switch (the question „Dann entfällt auch: …“): bundles in
 * effect now that need or include a switch no longer in effect.
 */
export function exceptionDropPreview(rights: UserRightsDto, id: BundleId, overrides: UserRightsInput['overrides']): BundleId[] {
  const now = new Set(rights.bundles.filter(bundle => bundle.effective.enabled).map(bundle => bundle.id))
  const after = effectiveWith(rights, overrides)
  if (after.has(id) || !now.has(id)) return []
  return bundlesDroppedWith([id]).filter(other => now.has(other))
}
