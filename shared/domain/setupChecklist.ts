/**
 * „Was noch fehlt“: what the Leitung or the Träger has not entered yet in the active facility. Each item disappears by
 * itself once the data is there; an item hidden with „Brauchen wir nicht“ (per facility) does not count.
 * The texts live in the app's locale; this file only decides which items are open.
 */

export const SETUP_AREAS = ['facility', 'staff', 'children'] as const
export type SetupArea = typeof SETUP_AREAS[number]

export const SETUP_ITEM_KEYS = [
  'opening_hours', 'terminal_account', 'group_type', 'facility_capacity',
  'employee_pin', 'employee_pin_locked', 'employee_qualification', 'employee_birthday', 'employee_access',
  'child_care_type', 'group_documentation',
] as const
export type SetupItemKey = typeof SETUP_ITEM_KEYS[number]

/** Items only the Träger can fix, so only the Träger sees (and hides) them. */
export const SETUP_PROVIDER_ONLY_KEYS: readonly SetupItemKey[] = ['facility_capacity']

/** Items about tablet PINs: only who sets and unlocks PINs (Leitung, Träger: `mayManagePins`) sees them. */
export const SETUP_PIN_KEYS: readonly SetupItemKey[] = ['employee_pin', 'employee_pin_locked']

/** Names shown per item; the rest is only counted. */
export const SETUP_MAX_NAMES = 5

export interface SetupFacts {
  /** The facility has at least one weekday of opening hours entered (times or closed). */
  openingHoursEntered: boolean
  /** An active tablet (terminal) account works in the facility. */
  hasTerminalAccount: boolean
  /** The facility's Höchstzahl Kinder is set (only the Träger sets it). */
  capacitySet: boolean
  /** The state's staffing rules of today know group types (Gruppenart). */
  usesGroupTypes: boolean
  /** Time tracking is on (a start day is set). */
  timeTrackingOn: boolean
  groups: { id: number; name: string; groupType: string | null; documentationOn: boolean }[]
  /**
   * The facility's employees who have not left; `pinLocked` = locked until the Leitung or the Träger unlocks it (the
   * 15- and 30-minute locks end by themselves and do not count).
   */
  employees: {
    id: number; name: string; hasPin: boolean; pinLocked: boolean; hasQualification: boolean; hasBirthday: boolean
    hasAccount: boolean
  }[]
  /** The facility's children with a contract today (entered and not left), as the children list shows them. */
  children: { id: number; name: string; hasCareType: boolean }[]
}

export interface SetupName { name: string; to: string }

export interface SetupItem {
  key: SetupItemKey
  area: SetupArea
  /** How many are affected (1 for an item about the facility itself). */
  count: number
  /** Up to SETUP_MAX_NAMES affected people or groups, each with the place to fix it. */
  names: SetupName[]
  /** Where to fix it. */
  to: string
  /** Only the Träger sees it. */
  providerOnly: boolean
}

export interface SetupChecklist {
  open: SetupItem[]
  hidden: SetupItem[]
}

const employeePath = (id: number, tab: string) => `/admin/employees/${id}?tab=${tab}`
const groupPath = (id: number) => `/admin/settings/groups/${id}`

function listItem<T extends { name: string }>(
  key: SetupItemKey, area: SetupArea, affected: T[], link: (entry: T) => string, listPath: string,
): SetupItem | null {
  if (affected.length === 0) return null
  const names = affected.slice(0, SETUP_MAX_NAMES).map(entry => ({ name: entry.name, to: link(entry) }))
  return {
    key, area, count: affected.length, names, to: affected.length === 1 ? names[0]!.to : listPath,
    providerOnly: SETUP_PROVIDER_ONLY_KEYS.includes(key),
  }
}

const facilityItem = (key: SetupItemKey, area: SetupArea, to: string): SetupItem =>
  ({ key, area, count: 1, names: [], to, providerOnly: SETUP_PROVIDER_ONLY_KEYS.includes(key) })

/** Every open item of the facility, in the order of the areas, before hiding and the viewer's role. */
export function setupItems(facts: SetupFacts): SetupItem[] {
  const active = facts.employees
  const items: (SetupItem | null)[] = [
    facts.openingHoursEntered ? null : facilityItem('opening_hours', 'facility', '/admin/settings/facility#section-facility-hours'),
    facts.hasTerminalAccount ? null : facilityItem('terminal_account', 'facility', '/admin/users'),
    facts.usesGroupTypes
      ? listItem('group_type', 'facility', facts.groups.filter(group => group.groupType === null), group => groupPath(group.id), '/admin/settings/groups')
      : null,
    facts.capacitySet ? null : facilityItem('facility_capacity', 'facility', '/admin/settings/facility#section-facilities'),
    facts.timeTrackingOn
      ? listItem('employee_pin', 'staff', active.filter(e => !e.hasPin), e => employeePath(e.id, 'stamping'), '/admin/employees')
      : null,
    listItem('employee_pin_locked', 'staff', active.filter(e => e.hasPin && e.pinLocked), e => employeePath(e.id, 'stamping'), '/admin/employees'),
    listItem('employee_qualification', 'staff', active.filter(e => !e.hasQualification), e => employeePath(e.id, 'qualification'), '/admin/employees'),
    listItem('employee_birthday', 'staff', active.filter(e => !e.hasBirthday), e => employeePath(e.id, 'master'), '/admin/employees'),
    listItem('employee_access', 'staff', active.filter(e => !e.hasAccount), e => employeePath(e.id, 'access'), '/admin/users'),
    listItem('child_care_type', 'children', facts.children.filter(child => !child.hasCareType), child => `/children/${child.id}`, '/children'),
    listItem('group_documentation', 'children', facts.groups.filter(group => !group.documentationOn), group => groupPath(group.id), '/admin/settings/groups'),
  ]
  return items.filter((item): item is SetupItem => item !== null)
}

/**
 * The checklist as this viewer sees it: items for the Träger only are left out for the Leitung, the PIN items for
 * whoever cannot set PINs (an account granted „Einstellungen der Einrichtung“ that is no Leitung); the hidden keys
 * („Brauchen wir nicht“) go to `hidden` and do not count.
 */
export function setupChecklist(
  facts: SetupFacts, viewer: { isProvider: boolean; managesPins: boolean }, hiddenKeys: readonly string[],
): SetupChecklist {
  const hidden = new Set(hiddenKeys)
  const visible = setupItems(facts).filter(item => (!item.providerOnly || viewer.isProvider)
    && (viewer.managesPins || !SETUP_PIN_KEYS.includes(item.key)))
  return { open: visible.filter(item => !hidden.has(item.key)), hidden: visible.filter(item => hidden.has(item.key)) }
}

export function isSetupItemKey(key: unknown): key is SetupItemKey {
  return typeof key === 'string' && (SETUP_ITEM_KEYS as readonly string[]).includes(key)
}
