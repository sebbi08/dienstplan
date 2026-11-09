// scripts/route-access-snapshot.mjs imports this file in plain Node (type stripping): keep other imports `import type`
// only and avoid TS syntax that emits code (enum, namespace, parameter properties).

/**
 * The permission catalog (spec Rechte und Rollen §2, inventory §6): every check asks "may this person do X" instead of
 * looking at the role. What a person holds comes from the bundles of the rights page (permissionBundles.ts,
 * `effectivePermissions`). The Träger has every key; the tablet role is not part of the catalog (its guards stay, and
 * at the unlocked tablet the unlocking person's permissions apply).
 */

/** The areas of the catalog, in the order the rights page lists them. */
export const PERMISSION_AREAS = [
  'plan', 'leave', 'time', 'employees', 'children', 'forms', 'teamMeetings', 'notes', 'cash', 'calendar', 'settings', 'users',
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
  notes: 'Notizen',
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
  'notes.view', 'notes.write',
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
  def('employees.docs.contract', 'employees', 'Dokumente: Vertrag und Nachträge, Stellenbeschreibung', { requires: ['employees.view'] }),
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
    { requires: ['settings.facility'], ...fixed }),
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

  def('notes.view', 'notes', 'Notizen lesen'),
  def('notes.write', 'notes', 'Notizen anlegen, ändern, löschen', { requires: ['notes.view'], scoped: true }),

  def('cash.view', 'cash', 'Kassen ansehen, Ausdruck, Excel'),
  def('cash.book', 'cash', 'Kasse führen (Kassen anlegen/archivieren, buchen, Belege)', { requires: ['cash.view'] }),
  def('cash.close', 'cash', 'Monate abschließen', { requires: ['cash.view'] }),
  def('cash.reopen', 'cash', 'Abgeschlossenen Monat wieder öffnen', { requires: ['cash.close'] }),
  def('cash.purge', 'cash', 'Archivierte Kasse endgültig löschen', fixed),

  def('calendar.own', 'calendar', 'Jahreskalender ansehen (eigene Sicht)'),
  def('calendar.edit', 'calendar', 'Jahreskalender und Termine bearbeiten'),
  def('closures.manage', 'calendar', 'Schließzeiten, frühere Schließungen, Öffnungszeiten'),

  def('settings.facility', 'settings', 'Einstellungen der Einrichtung'),
  def('settings.staffing', 'settings', 'Personalschlüssel-Werte ändern', { requires: ['settings.facility'], ...fixed }),
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
 * The rights of Leitung and Mitarbeiter in Teil 1 (inventory §6 „Defaults“, plus `printTemplates.view` for
 * Mitarbeiter since the template categories), without the per-person flags of that time. Since Teil 2 the defaults are
 * bundles (`BUNDLE_DEFAULTS` in permissionBundles.ts); this list stays as the reference they are tested against (they
 * give exactly these keys, plus the approved `cash.reopen` for the Leitung).
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
    'notes.view', 'notes.write',
    'cash.view', 'cash.book', 'cash.close',
    'calendar.own', 'calendar.edit', 'closures.manage',
    'settings.facility',
    'users.manage',
  ],
  observer: [
    'plan.view', 'leave.request', 'time.own', 'talks.own', 'teamMeetings.write', 'calendar.own', 'children.view',
    'children.attendance', 'notes.view',
    // The print templates to read (the categories visible to all), since the template categories; not to change.
    'printTemplates.view',
  ],
}

const BY_KEY = new Map(PERMISSIONS.map(permission => [permission.key, permission]))

/**
 * Closes a set of granted keys (spec §3.3): what a key implies is added, then every key whose requirement is missing
 * is dropped – also a key whose implied key had to be dropped, since it cannot come without it – until nothing changes.
 * A key the catalog does not know (say, from an older database) is ignored.
 */
export function resolvePermissions(granted: Iterable<PermissionKey>): ReadonlySet<PermissionKey> {
  const keys = new Set([...granted].filter(key => BY_KEY.has(key)))
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
 * The child keys that change records and so need an account to record as "changed by": a person without one at the
 * tablet never passes them (server/lib/childViewer.ts; the route snapshot script and the permission test use the same
 * list).
 */
export type ChildActorKey = 'children.edit' | 'children.manage'
export const CHILD_ACTOR_KEYS: readonly ChildActorKey[] = ['children.edit', 'children.manage']

/** Whether the set holds the key. */
export function can(permissions: ReadonlySet<PermissionKey>, key: PermissionKey): boolean {
  return permissions.has(key)
}
