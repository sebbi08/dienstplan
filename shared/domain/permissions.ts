// scripts/route-access-snapshot.mjs imports this file in plain Node (type stripping): keep other imports `import type`
// only and avoid TS syntax that emits code (enum, namespace, parameter properties).
import type { Role } from '../types/api'

/**
 * The permission catalog (spec Rechte und Rollen §2, inventory §6): every check asks "may this person do X" instead of
 * looking at the role. Teil 1 keeps today's rights exactly: the role defaults below plus today's per-person flags give
 * the same answers as the role checks did. The Träger has every key; the tablet role is not part of the catalog (its
 * guards stay, and at the unlocked tablet the unlocking person's permissions apply).
 */

/** The areas of the catalog, in the order the rights page lists them. */
export const PERMISSION_AREAS = [
  'plan', 'leave', 'time', 'employees', 'children', 'forms', 'teamMeetings', 'cash', 'calendar', 'settings', 'users',
  'facilities',
] as const
export type PermissionArea = typeof PERMISSION_AREAS[number]

export const AREA_LABELS: Record<PermissionArea, string> = {
  plan: 'Dienstplan',
  leave: 'Urlaub',
  time: 'Zeiterfassung',
  employees: 'Mitarbeiter',
  children: 'Kinder',
  forms: 'Bögen, Vorlagen und Gespräche',
  teamMeetings: 'Teamsitzungen',
  cash: 'Kasse',
  calendar: 'Kalender und Schließzeiten',
  settings: 'Einstellungen',
  users: 'Benutzer und Rechte',
  facilities: 'Einrichtungen, Löschfristen und Datensicherung',
}

/** Every key of the catalog, in catalog order. */
export const PERMISSION_KEYS = [
  'plan.view', 'plan.edit', 'plan.release', 'plan.staffing',
  'leave.request', 'leave.overview', 'leave.plan', 'leave.configure',
  'time.own', 'time.manage',
  'employees.view', 'employees.edit', 'employees.sickness', 'employees.contractView', 'employees.contractEdit',
  'employees.delete', 'employees.moveFacility',
  'employees.personal', 'employees.sensitive', 'employees.payroll', 'employees.docs.qualifications', 'employees.docs.contract',
  'employees.docs.application', 'employees.docs.correspondence', 'employees.docs.measures', 'employees.docs.salary',
  'children.view', 'children.ownAccount', 'children.planned', 'children.attendance', 'children.edit', 'children.manage',
  'children.schoolSettings', 'children.deleteArchived', 'children.moveFacility',
  'childForms.edit', 'childForms.manage', 'formTemplates.manage', 'printTemplates.view', 'printTemplates.edit',
  'printTemplates.global', 'talks.manage', 'talks.own',
  'teamMeetings.write', 'teamMeetings.manage',
  'cash.view', 'cash.book', 'cash.close', 'cash.reopen', 'cash.purge',
  'calendar.own', 'calendar.edit', 'closures.manage',
  'settings.facility', 'settings.staffing', 'settings.absenceCodes', 'settings.groups', 'settings.retention',
  'settings.otherFacility',
  'users.manage', 'users.providerAccounts', 'rights.manage',
  'facilities.manage', 'retention.delete', 'backup.download',
] as const
export type PermissionKey = typeof PERMISSION_KEYS[number]

export interface PermissionDef {
  key: PermissionKey
  /** German name on the rights page. */
  label: string
  area: PermissionArea
  /** Keys without which this one does not hold (spec §2 „braucht“). */
  requires: PermissionKey[]
  /** Keys that come with this one (spec §2 „schließt ein“). */
  implies: PermissionKey[]
  /** Has a group scope: own group (today's `groupRight`), all groups for a person without home group. */
  scoped: boolean
  /** Fixed at the Träger, never grantable (P-fix in the inventory). */
  providerOnly: boolean
}

type Options = Partial<Pick<PermissionDef, 'requires' | 'implies' | 'scoped' | 'providerOnly'>>

function def(key: PermissionKey, area: PermissionArea, label: string, options: Options = {}): PermissionDef {
  return { key, label, area, requires: [], implies: [], scoped: false, providerOnly: false, ...options }
}

const fixed = { providerOnly: true }

export const PERMISSIONS: readonly PermissionDef[] = [
  def('plan.view', 'plan', 'Freigegebenen Dienstplan ansehen'),
  def('plan.edit', 'plan', 'Dienstplan-Entwurf ansehen und bearbeiten, Vorlagen, Aushilfen, Warnungen',
    { requires: ['plan.view'] }),
  def('plan.release', 'plan', 'Dienstplan freigeben und Änderungen verwerfen', { implies: ['plan.edit'] }),
  def('plan.staffing', 'plan', 'Personalschlüssel ansehen'),

  def('leave.request', 'leave', 'Urlaub beantragen, eigene Anträge'),
  def('leave.overview', 'leave', 'Urlaubsübersicht aller', { requires: ['employees.view'] }),
  def('leave.plan', 'leave', 'Urlaubsplanung: entscheiden, Kalender, Höchstzahl', { requires: ['leave.overview'] }),
  def('leave.configure', 'leave',
    'Urlaubsanträge ein- und ausschalten, Zuständige festlegen, Urlaub an Heiligabend/Silvester', fixed),

  def('time.own', 'time', 'Eigene Zeiten sehen, mit dem Handy stempeln'),
  def('time.manage', 'time', 'Alle Stempelzeiten ansehen, nachtragen, korrigieren; Stundenkonten',
    { requires: ['employees.view'] }),

  def('employees.view', 'employees', 'Mitarbeiter ansehen (Liste, Akte, fällige Pflichttermine)'),
  def('employees.edit', 'employees',
    'Mitarbeiter anlegen und pflegen (Stunden, Urlaubsanspruch, PIN, Stempeln, Pflichttermine, Fortbildungen, Reihenfolge)',
    { requires: ['employees.view'] }),
  def('employees.sickness', 'employees', 'Krankheitstage, „im Dienst erkrankt“', { requires: ['employees.view'] }),
  def('employees.contractView', 'employees', 'Vertragsangaben und Stufenaufstieg ansehen',
    { requires: ['employees.view'] }),
  def('employees.contractEdit', 'employees', 'Vertragsangaben bearbeiten', { requires: ['employees.contractView'] }),
  def('employees.delete', 'employees', 'Ausgeschiedene endgültig löschen', { requires: ['employees.edit'] }),
  def('employees.moveFacility', 'employees', 'Mitarbeiter in andere Einrichtung verschieben', fixed),
  // The personnel file (spec Personalakte §6): grantable, by default only the Träger's apart from the Leitung's two.
  def('employees.personal', 'employees', 'Anschrift, Kontakt und Geburtsdatum', { requires: ['employees.view'] }),
  def('employees.sensitive', 'employees', 'Staatsangehörigkeit und Schwerbehinderung', { requires: ['employees.view'] }),
  def('employees.payroll', 'employees', 'Lohn und Steuer', { requires: ['employees.view'] }),
  def('employees.docs.qualifications', 'employees', 'Dokumente: Qualifikationen und Fortbildungen',
    { requires: ['employees.view'] }),
  def('employees.docs.contract', 'employees', 'Dokumente: Vertrag und Nachträge', { requires: ['employees.view'] }),
  def('employees.docs.application', 'employees', 'Dokumente: Bewerbung', { requires: ['employees.view'] }),
  def('employees.docs.correspondence', 'employees', 'Dokumente: Korrespondenz', { requires: ['employees.view'] }),
  def('employees.docs.measures', 'employees', 'Dokumente: Arbeitsrechtliche Maßnahmen', { requires: ['employees.view'] }),
  def('employees.docs.salary', 'employees', 'Dokumente: Gehalt', { requires: ['employees.view'] }),

  def('children.view', 'children',
    'Kinderliste und Akten ansehen (inkl. Bögen lesen, Dokumente, Geburtstage, Erinnerungen)', { scoped: true }),
  def('children.ownAccount', 'children', 'Kinder mit dem eigenen Konto ansehen (nicht nur am Tablet)',
    { requires: ['children.view'] }),
  def('children.planned', 'children',
    'Vormerkungen und künftige Verträge immer sehen (unabhängig von den Tablet-Schaltern)',
    { requires: ['children.view'] }),
  def('children.attendance', 'children', 'Anwesenheit, Gruppenbuch, Doku „erledigt“',
    { requires: ['children.view'], scoped: true }),
  def('children.edit', 'children', 'Kinder anlegen und Akten ändern (inkl. vertrauliche Dokumente öffnen)',
    { requires: ['children.view'], scoped: true }),
  def('children.manage', 'children',
    'Kinder abmelden, Archiv, Belegung, Gruppenwechsel, Schulkinder; Leitungsfelder (Einschulung von Hand, '
    + 'Gesprächsnotiz, Plätze, Erledigt zurücknehmen)',
    { requires: ['children.view', 'children.edit'] }),
  def('children.schoolSettings', 'children', 'Stichtag, automatische Abmeldung, Gruppe „für Schulkinder“',
    { requires: ['settings.facility'] }),
  def('children.deleteArchived', 'children', 'Archivierte Akten löschen', { requires: ['children.manage'], ...fixed }),
  def('children.moveFacility', 'children', 'Kind in andere Einrichtung verschieben', fixed),

  def('childForms.edit', 'forms', 'Alle Beobachtungsbögen anlegen und ausfüllen',
    { requires: ['children.view'], scoped: true }),
  def('childForms.manage', 'forms', 'Bearbeiter freischalten, Bögen löschen', { requires: ['childForms.edit'] }),
  def('formTemplates.manage', 'forms', 'Vorlagen (Bögen) verwalten'),
  def('printTemplates.view', 'forms', 'Druckvorlagen ansehen'),
  def('printTemplates.edit', 'forms', 'Druckvorlagen der Einrichtung verwalten', { requires: ['printTemplates.view'] }),
  def('printTemplates.global', 'forms', 'Druckvorlagen für alle Einrichtungen',
    { requires: ['printTemplates.edit'], ...fixed }),
  def('talks.manage', 'forms', 'Mitarbeitergespräche führen', { requires: ['employees.view'] }),
  def('talks.own', 'forms', 'Eigene Gesprächsbögen'),

  def('teamMeetings.write', 'teamMeetings', 'Sitzungen anlegen und mitschreiben'),
  def('teamMeetings.manage', 'teamMeetings', 'Protokoll freigeben, wieder öffnen, löschen',
    { implies: ['teamMeetings.write'] }),

  def('cash.view', 'cash', 'Kassen ansehen, Ausdruck, Excel'),
  def('cash.book', 'cash', 'Kasse führen (Kassen anlegen/archivieren, buchen, Belege)', { requires: ['cash.view'] }),
  def('cash.close', 'cash', 'Monate abschließen', { requires: ['cash.view'] }),
  def('cash.reopen', 'cash', 'Abgeschlossenen Monat wieder öffnen', { requires: ['cash.close'] }),
  def('cash.purge', 'cash', 'Archivierte Kasse endgültig löschen', fixed),

  def('calendar.own', 'calendar', 'Jahreskalender ansehen (eigene Sicht)'),
  def('calendar.edit', 'calendar', 'Jahreskalender und Termine bearbeiten'),
  def('closures.manage', 'calendar', 'Schließzeiten, frühere Schließungen, Öffnungszeiten'),

  def('settings.facility', 'settings', 'Einstellungen der Einrichtung'),
  def('settings.staffing', 'settings', 'Personalschlüssel-Werte ändern', { requires: ['settings.facility'] }),
  def('settings.absenceCodes', 'settings', 'Codes (Urlaub, Krank …) ändern', fixed),
  def('settings.groups', 'settings', 'Gruppen anlegen, umbenennen, löschen, sortieren',
    { requires: ['settings.facility'], ...fixed }),
  def('settings.retention', 'settings',
    'Löschfristen und „wer darf endgültig löschen“, Löschfrist Kinderakten', fixed),
  def('settings.otherFacility', 'settings', 'Einstellungen anderer Einrichtungen („Einstellungen für“)', fixed),

  def('users.manage', 'users', 'Zugänge Leitung/Mitarbeiter/Tablet verwalten (inkl. „darf Kinderakten pflegen“)'),
  def('users.providerAccounts', 'users', 'Träger-Zugänge anlegen und ändern', fixed),
  def('rights.manage', 'users', 'Rechte und Rollen einstellen (inkl. Vertragsangaben für die Leitung)', fixed),

  def('facilities.manage', 'facilities', 'Einrichtungen anlegen, umbenennen, Höchstzahl, wechseln', fixed),
  def('retention.delete', 'facilities', 'Löschen nach Fristen', fixed),
  def('backup.download', 'facilities', 'Datensicherung', fixed),
]

/**
 * Today's rights of Leitung and Mitarbeiter (inventory §6 „Defaults“). Not in here because they come from today's
 * per-person flags (see `effectivePermissions`): `leave.plan`, `employees.contractView` (Leitung), `children.edit`
 * (Mitarbeiter).
 */
export const ROLE_DEFAULTS: Record<'admin' | 'observer', PermissionKey[]> = {
  admin: [
    'plan.view', 'plan.edit', 'plan.release', 'plan.staffing',
    'leave.request', 'leave.overview',
    'time.own', 'time.manage',
    'employees.view', 'employees.edit', 'employees.sickness', 'employees.delete',
    'employees.personal', 'employees.docs.qualifications',
    'children.view', 'children.ownAccount', 'children.planned', 'children.attendance', 'children.edit',
    'children.manage',
    'childForms.edit', 'childForms.manage', 'formTemplates.manage', 'printTemplates.view', 'printTemplates.edit',
    'talks.manage', 'talks.own',
    'teamMeetings.write', 'teamMeetings.manage',
    'cash.view', 'cash.book', 'cash.close',
    'calendar.own', 'calendar.edit', 'closures.manage',
    'settings.facility',
    'users.manage',
  ],
  observer: [
    'plan.view', 'leave.request', 'time.own', 'talks.own', 'teamMeetings.write', 'calendar.own', 'children.view',
    'children.attendance',
  ],
}

export interface PermissionInput {
  role: Role
  /** `users.can_edit_children`: a Mitarbeiter maintains child records (at the unlocked tablet). */
  canEditChildren: boolean
  /**
   * The account counts as leave planner **for the facility in question**: the caller applies `isPlanner`'s rule (a
   * Leitung in `leave_planners` plans only in its own facility) and passes false for any other facility.
   */
  isLeavePlanner: boolean
  /** The Träger's global switch `contract_visible_to_admins`: the Leitung sees the contract fields. */
  contractVisibleToAdmins: boolean
}

const BY_KEY = new Map(PERMISSIONS.map(permission => [permission.key, permission]))

/**
 * Closes a set of granted keys (spec §3.3): what a key implies is added, then every key whose requirement is missing
 * is dropped – also a key whose implied key had to be dropped, since it cannot come without it – until nothing changes.
 */
export function resolvePermissions(granted: Iterable<PermissionKey>): ReadonlySet<PermissionKey> {
  const keys = new Set(granted)
  const pending = [...keys]
  while (pending.length > 0) {
    for (const implied of BY_KEY.get(pending.pop()!)!.implies) {
      if (!keys.has(implied)) {
        keys.add(implied)
        pending.push(implied)
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const key of keys) {
      const permission = BY_KEY.get(key)!
      if ([...permission.requires, ...permission.implies].some(other => !keys.has(other))) {
        keys.delete(key)
        changed = true
      }
    }
  }
  return keys
}

/**
 * The permissions a person has, computed from the role and today's per-person flags (pure, no database): the Träger
 * has every key, the tablet role none (its own guards decide), Leitung and Mitarbeiter their role defaults plus the
 * flags, closed under requires and implies. Flags only count for the role they belong to today: the child flag for a
 * Mitarbeiter, leave planning and the contract switch for a Leitung.
 */
export function effectivePermissions(input: PermissionInput): ReadonlySet<PermissionKey> {
  if (input.role === 'provider') return new Set(PERMISSION_KEYS)
  if (input.role === 'terminal') return new Set()
  const granted = [...ROLE_DEFAULTS[input.role]]
  if (input.role === 'observer' && input.canEditChildren) granted.push('children.edit')
  if (input.role === 'admin' && input.isLeavePlanner) granted.push('leave.plan')
  if (input.role === 'admin' && input.contractVisibleToAdmins) granted.push('employees.contractView')
  return resolvePermissions(granted)
}

/** Whether the set holds the key. */
export function can(permissions: ReadonlySet<PermissionKey>, key: PermissionKey): boolean {
  return permissions.has(key)
}
