// scripts/route-access-snapshot.mjs imports this file in plain Node (type stripping): runtime imports carry the `.ts`
// extension, other imports are `import type` only, and no TS syntax that emits code (enum, namespace, parameter
// properties).
import type { Role } from '../types/api'
import { PERMISSIONS, resolvePermissions, type PermissionKey } from './permissions.ts'

/**
 * The switches of the rights page (spec Rechte und Rollen Teil 2 §2): the Träger sets bundles of catalog keys per role
 * and as exceptions per person, never single keys. Every key a Leitung or Mitarbeiter can hold belongs to exactly one
 * bundle, apart from the baseline every account has (`BASELINE_KEYS`); the Träger-only keys (`providerOnly`) are in no
 * bundle.
 */

/** The areas of the rights page, in the order it lists them. */
export const BUNDLE_AREAS = [
  'plan', 'leave', 'time', 'employees', 'personnelFile', 'children', 'forms', 'teamMeetings', 'cash', 'calendar',
  'templates', 'administration',
] as const
export type BundleArea = typeof BUNDLE_AREAS[number]

export const BUNDLE_AREA_LABELS: Record<BundleArea, string> = {
  plan: 'Dienstplan',
  leave: 'Urlaub',
  time: 'Zeiten',
  employees: 'Mitarbeiter',
  personnelFile: 'Personalakte',
  children: 'Kinder',
  forms: 'Bögen',
  teamMeetings: 'Teamsitzungen',
  cash: 'Kasse',
  calendar: 'Kalender',
  templates: 'Vorlagen',
  administration: 'Verwaltung',
}

export const BUNDLE_IDS = [
  'planView', 'planEdit', 'planRelease',
  'leaveRequest', 'leavePlan',
  'timeOwn', 'timeManage',
  'employeesView', 'employeesEdit', 'contractView', 'contractEdit', 'employeesDelete', 'talksManage',
  'personal', 'payrollSensitive', 'docsQualifications', 'docsOther',
  'childrenView', 'childrenAttendance', 'childrenEdit', 'childrenManage', 'childrenOwnAccount',
  'formsFill', 'formsManage',
  'teamMeetingsWrite', 'teamMeetingsRelease',
  'cashBook', 'cashClose',
  'calendarView', 'calendarEdit',
  'templatesView', 'templatesEdit',
  'settingsFacility', 'usersManage',
] as const
export type BundleId = typeof BUNDLE_IDS[number]

/** The reach of a children bundle: 'group' = the own group (today's `groupRight`, no home group = all groups). */
export type BundleScope = 'group' | 'facility'
/** The roles whose rights the Träger sets (Teil 3 adds the Gruppenleitung). */
export type RightsRole = 'admin' | 'observer'
export const RIGHTS_ROLES: readonly RightsRole[] = ['admin', 'observer']

export interface BundleDef {
  id: BundleId
  area: BundleArea
  /** German name of the switch on the rights page (spec §2 „Schalter“). */
  label: string
  /** The catalog keys the switch stands for (spec §2 „Einzelrechte“, verbatim). */
  keys: readonly PermissionKey[]
  /** Has a scope ('group' | 'facility'): the children bundles view, attendance and edit. */
  scoped: boolean
  /**
   * The bundles without which this one does not hold, computed from the catalog: every key a bundle key requires or
   * implies and that lies in another bundle makes that bundle required.
   */
  requires: readonly BundleId[]
}

type Spec = Omit<BundleDef, 'requires'>

function bundle(id: BundleId, area: BundleArea, label: string, keys: PermissionKey[], scoped = false): Spec {
  return { id, area, label, keys, scoped }
}

const SPECS: readonly Spec[] = [
  bundle('planView', 'plan', 'ansehen', ['plan.view']),
  bundle('planEdit', 'plan', 'bearbeiten (inkl. Personalschlüssel ansehen)', ['plan.edit', 'plan.staffing']),
  bundle('planRelease', 'plan', 'freigeben', ['plan.release']),

  bundle('leaveRequest', 'leave', 'beantragen', ['leave.request']),
  bundle('leavePlan', 'leave', 'planen und genehmigen', ['leave.plan']),

  bundle('timeOwn', 'time', 'eigene Zeiten und Stempeln', ['time.own']),
  bundle('timeManage', 'time', 'alle Zeiten und Stundenkonten verwalten', ['time.manage']),

  bundle('employeesView', 'employees', 'ansehen (inkl. Urlaubsübersicht aller)', ['employees.view', 'leave.overview']),
  bundle('employeesEdit', 'employees', 'pflegen (inkl. Krankheitstage)', ['employees.edit', 'employees.sickness']),
  bundle('contractView', 'employees', 'Vertragsangaben ansehen', ['employees.contractView']),
  bundle('contractEdit', 'employees', 'Vertragsangaben bearbeiten', ['employees.contractEdit']),
  bundle('employeesDelete', 'employees', 'ausgeschiedene endgültig löschen', ['employees.delete']),
  bundle('talksManage', 'employees', 'Mitarbeitergespräche führen', ['talks.manage']),

  bundle('personal', 'personnelFile', 'Anschrift und Kontakt', ['employees.personal']),
  bundle('payrollSensitive', 'personnelFile', 'Lohn, Steuer und sensible Daten',
    ['employees.payroll', 'employees.sensitive']),
  bundle('docsQualifications', 'personnelFile', 'Dokumente Qualifikationen', ['employees.docs.qualifications']),
  bundle('docsOther', 'personnelFile', 'alle übrigen Dokumente', [
    'employees.docs.contract', 'employees.docs.application', 'employees.docs.correspondence',
    'employees.docs.measures', 'employees.docs.salary',
  ]),

  bundle('childrenView', 'children', 'ansehen', ['children.view'], true),
  bundle('childrenAttendance', 'children', 'Anwesenheit und Gruppenbuch', ['children.attendance'], true),
  bundle('childrenEdit', 'children', 'eintragen und Akten ändern', ['children.edit'], true),
  bundle('childrenManage', 'children', 'verwalten (Abmelden, Belegung, Archiv, Vormerkungen)',
    ['children.manage', 'children.planned']),
  bundle('childrenOwnAccount', 'children', 'auch mit eigenem Zugang (nicht nur am Tablet)', ['children.ownAccount']),

  bundle('formsFill', 'forms', 'ausfüllen', ['childForms.edit']),
  bundle('formsManage', 'forms', 'verwalten (Vorlagen, Freigaben)', ['childForms.manage', 'formTemplates.manage']),

  bundle('teamMeetingsWrite', 'teamMeetings', 'mitschreiben', ['teamMeetings.write']),
  bundle('teamMeetingsRelease', 'teamMeetings', 'freigeben', ['teamMeetings.manage']),

  bundle('cashBook', 'cash', 'ansehen und führen', ['cash.view', 'cash.book']),
  bundle('cashClose', 'cash', 'Monate abschließen und wieder öffnen', ['cash.close', 'cash.reopen']),

  bundle('calendarView', 'calendar', 'ansehen', ['calendar.own']),
  bundle('calendarEdit', 'calendar', 'Termine und Schließzeiten bearbeiten', ['calendar.edit', 'closures.manage']),

  bundle('templatesView', 'templates', 'ansehen', ['printTemplates.view']),
  bundle('templatesEdit', 'templates', 'bearbeiten', ['printTemplates.edit']),

  bundle('settingsFacility', 'administration', 'Einstellungen der Einrichtung', ['settings.facility']),
  bundle('usersManage', 'administration', 'Zugänge verwalten', ['users.manage']),
]

/**
 * Keys every Leitung and Mitarbeiter account has, without a switch (spec §2 „Eigene Daten … kein Schalter“): the own
 * staff talk forms. (The own plan and the password need no key.)
 */
export const BASELINE_KEYS: readonly PermissionKey[] = ['talks.own']

const CATALOG = new Map(PERMISSIONS.map(permission => [permission.key, permission]))
const BUNDLE_OF_KEY = new Map<PermissionKey, BundleId>(SPECS.flatMap(spec => spec.keys.map(key => [key, spec.id] as const)))

function requiredBundles(spec: Spec): BundleId[] {
  const required = new Set<BundleId>()
  for (const key of spec.keys) {
    const permission = CATALOG.get(key)!
    for (const other of [...permission.requires, ...permission.implies]) {
      const owner = BUNDLE_OF_KEY.get(other)
      if (owner !== undefined && owner !== spec.id) required.add(owner)
    }
  }
  return BUNDLE_IDS.filter(id => required.has(id))
}

export const BUNDLES: readonly BundleDef[] = SPECS.map(spec => ({ ...spec, requires: requiredBundles(spec) }))

const BY_ID = new Map(BUNDLES.map(def => [def.id, def]))

export function isBundleId(value: string): value is BundleId {
  return BY_ID.has(value as BundleId)
}

/** The bundle holding the key (undefined for baseline and Träger-only keys). */
export function bundleOfKey(key: PermissionKey): BundleId | undefined {
  return BUNDLE_OF_KEY.get(key)
}

/**
 * The Grundeinstellung (spec §3: today's rights, Teil 1) as bundles: expanded they give `ROLE_DEFAULTS`, plus the one
 * approved change, the Leitung reopens closed cash months (`cashClose` holds cash.close and cash.reopen).
 */
export const BUNDLE_DEFAULTS: Record<RightsRole, readonly BundleId[]> = {
  admin: [
    'planView', 'planEdit', 'planRelease',
    'leaveRequest',
    'timeOwn', 'timeManage',
    'employeesView', 'employeesEdit', 'employeesDelete', 'talksManage',
    'personal', 'docsQualifications',
    'childrenView', 'childrenAttendance', 'childrenEdit', 'childrenManage', 'childrenOwnAccount',
    'formsFill', 'formsManage',
    'teamMeetingsWrite', 'teamMeetingsRelease',
    'cashBook', 'cashClose',
    'calendarView', 'calendarEdit',
    'templatesView', 'templatesEdit',
    'settingsFacility', 'usersManage',
  ],
  observer: [
    'planView', 'leaveRequest', 'timeOwn', 'teamMeetingsWrite', 'calendarView', 'childrenView', 'childrenAttendance',
    'templatesView',
  ],
}

/**
 * The scope of a role's scoped bundles when no row says otherwise: the Leitung works with the whole facility, a
 * Mitarbeiter with the own group (today's semantics).
 */
export const DEFAULT_SCOPE: Record<RightsRole, BundleScope> = { admin: 'facility', observer: 'group' }

/** A stored role setting (`role_bundles`): the switch on or off for every account of the role. */
export interface RoleBundleSetting {
  bundle: string
  enabled: boolean
  scope: BundleScope | null
}

/** A stored person exception (`user_bundle_overrides`): the switch granted or revoked for one account. */
export interface BundleOverride {
  bundle: string
  effect: 'grant' | 'revoke'
  scope: BundleScope | null
}

export interface PermissionInput {
  role: Role
  /** The role's stored settings; a bundle without a row keeps its default. Unknown bundle ids are ignored. */
  roleBundles?: readonly RoleBundleSetting[]
  /** The account's exceptions, applied in order (a later one for the same bundle wins). Unknown ids are ignored. */
  overrides?: readonly BundleOverride[]
}

export interface EffectiveRights {
  /** The bundles in effect, with their scope (null for a bundle without scope). */
  bundles: ReadonlyMap<BundleId, BundleScope | null>
  permissions: ReadonlySet<PermissionKey>
  /** The scope of every held key of a scoped bundle ('facility' for every scoped key at the Träger). */
  scopes: ReadonlyMap<PermissionKey, BundleScope>
}

function isScope(value: unknown): value is BundleScope {
  return value === 'group' || value === 'facility'
}

/** The bundles of the role after its stored settings (no exceptions), with their scope. */
export function roleBundleMap(role: RightsRole, rows: readonly RoleBundleSetting[] = []): Map<BundleId, BundleScope | null> {
  const scopeOf = (id: BundleId, scope: BundleScope | null) => BY_ID.get(id)!.scoped ? (isScope(scope) ? scope : DEFAULT_SCOPE[role]) : null
  const bundles = new Map<BundleId, BundleScope | null>(BUNDLE_DEFAULTS[role].map(id => [id, scopeOf(id, null)]))
  for (const row of rows) {
    if (!isBundleId(row.bundle)) continue
    if (row.enabled) bundles.set(row.bundle, scopeOf(row.bundle, row.scope))
    else bundles.delete(row.bundle)
  }
  return bundles
}

/** Drops every bundle whose required bundles are missing, until nothing changes (the bundle level of §3.3). */
function closeBundles(bundles: Map<BundleId, BundleScope | null>): void {
  let changed = true
  while (changed) {
    changed = false
    for (const id of bundles.keys()) {
      if (BY_ID.get(id)!.requires.some(required => !bundles.has(required))) {
        bundles.delete(id)
        changed = true
      }
    }
  }
}

const PROVIDER_ONLY = new Set(PERMISSIONS.filter(permission => permission.providerOnly).map(permission => permission.key))
const SCOPED_KEYS = BUNDLES.filter(def => def.scoped).flatMap(def => def.keys)

/**
 * What an account may do (spec Teil 2 §5): the Träger everything, the tablet role nothing (its own guards decide),
 * Leitung and Mitarbeiter: the role's settings (else the defaults) → the person's exceptions (grant adds, revoke
 * removes) → bundles without their required bundles dropped → expanded to keys with the baseline → closed under
 * requires/implies (`resolvePermissions`) → Träger-only keys removed.
 */
export function effectiveRights(input: PermissionInput): EffectiveRights {
  if (input.role === 'provider') {
    return {
      bundles: new Map(BUNDLES.map(def => [def.id, def.scoped ? 'facility' : null])),
      permissions: new Set(PERMISSIONS.map(permission => permission.key)),
      scopes: new Map(SCOPED_KEYS.map(key => [key, 'facility'])),
    }
  }
  if (input.role === 'terminal') return { bundles: new Map(), permissions: new Set(), scopes: new Map() }
  const role = input.role
  const bundles = roleBundleMap(role, input.roleBundles)
  for (const override of input.overrides ?? []) {
    if (!isBundleId(override.bundle)) continue
    if (override.effect === 'revoke') bundles.delete(override.bundle)
    else if (override.effect === 'grant') {
      const def = BY_ID.get(override.bundle)!
      const scope = !def.scoped ? null
        : isScope(override.scope) ? override.scope : bundles.get(override.bundle) ?? DEFAULT_SCOPE[role]
      bundles.set(override.bundle, scope)
    }
  }
  closeBundles(bundles)
  const granted = [...BASELINE_KEYS, ...[...bundles.keys()].flatMap(id => BY_ID.get(id)!.keys)]
  const permissions = new Set([...resolvePermissions(granted)].filter(key => !PROVIDER_ONLY.has(key)))
  const scopes = new Map<PermissionKey, BundleScope>()
  for (const [id, scope] of bundles) {
    if (scope === null) continue
    for (const key of BY_ID.get(id)!.keys) if (permissions.has(key)) scopes.set(key, scope)
  }
  return { bundles, permissions, scopes }
}

/** The permission set of `effectiveRights`. */
export function effectivePermissions(input: PermissionInput): ReadonlySet<PermissionKey> {
  return effectiveRights(input).permissions
}

/** The keys the bundles stand for (no closure). */
export function expandBundles(ids: Iterable<BundleId>): PermissionKey[] {
  return [...ids].flatMap(id => BY_ID.get(id)!.keys)
}
