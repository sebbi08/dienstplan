import type { PermissionKey } from '#shared/domain/permissions'
import type { EmployeeListItemDto } from '#shared/types/api'
import { visibleFolders } from './personnel'

/** What the compact staff list flags at a person, in this order. */
export type StaffBadge = 'pinMissing' | 'pinLocked' | 'qualificationMissing' | 'requirementsOpen' | 'noAccess'

/**
 * The small badges of one row of the staff list: no stamp PIN (not on the tablet), a PIN that is locked right now, no
 * qualification for the staffing ratio, mandatory appointments in the notice (overdue, missing or due soon) and no
 * account linked to the person.
 */
export function staffBadges(
  employee: Pick<EmployeeListItemDto, 'hasPin' | 'pinLocked' | 'qualification'>,
  context: { requirementsOpen: boolean; hasAccount: boolean },
): StaffBadge[] {
  const badges: StaffBadge[] = []
  if (!employee.hasPin) badges.push('pinMissing')
  else if (employee.pinLocked) badges.push('pinLocked')
  if (employee.qualification === null) badges.push('qualificationMissing')
  if (context.requirementsOpen) badges.push('requirementsOpen')
  if (!context.hasAccount) badges.push('noAccess')
  return badges
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/**
 * A username proposed for a person's new account: the name in lower case without spaces, umlauts as ae/oe/ue/ss, other
 * accents dropped and only letters and digits kept („Jana Müller-Weiß“ → „janamuellerweiss“). When that one is taken
 * (compared in lower case, as the server does), a number is added („janamueller2“). Empty when nothing usable is left.
 */
export function suggestUsername(name: string, taken: readonly string[] = []): string {
  const base = name.normalize('NFC').toLowerCase()
    .replace(/[äöüß]/g, letter => UMLAUTS[letter]!)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
  if (!base) return ''
  const used = new Set(taken.map(username => username.trim().toLowerCase()))
  if (!used.has(base)) return base
  let number = 2
  while (used.has(`${base}${number}`)) number++
  return `${base}${number}`
}

/** The tabs of the employee page, in their order. */
export const EMPLOYEE_TABS = ['master', 'contract', 'times', 'records', 'talks', 'access'] as const
export type EmployeeTab = typeof EMPLOYEE_TABS[number]

/**
 * The sections of the employee page whose showing depends on the viewer, in their order, each with its tab. Their keys
 * are the former tab keys: a link with an old `?tab=` (e.g. `?tab=stamping`) still opens the right tab.
 */
export const EMPLOYEE_SECTIONS = {
  master: 'master', qualification: 'master',
  hours: 'contract', payroll: 'contract',
  leave: 'times', stamping: 'times',
  requirements: 'records', documents: 'records',
  talks: 'talks', access: 'access',
} as const satisfies Record<string, EmployeeTab>
export type EmployeeSection = keyof typeof EMPLOYEE_SECTIONS

/**
 * The sections the viewer sees on the employee page (reached with employees.view; „Zugang“ uses the users' routes and
 * needs users.manage, „Gespräche“ the staff talk routes and talks.manage, „Lohn und Steuer“ employees.payroll,
 * „Dokumente“ the key of at least one folder). The contract inside „Vertrag & Lohn“ follows its own switch. On their
 * own page (`own`) nobody gets „Gespräche“: a Leitung's talks are held by the Träger or another Leitung, they see them
 * under „Meine Gespräche“.
 */
export function employeeSections(can: (key: PermissionKey) => boolean, own = false): EmployeeSection[] {
  const shown: Record<EmployeeSection, boolean> = {
    master: true, qualification: true, hours: true, payroll: can('employees.payroll'), leave: true, stamping: true,
    requirements: true, documents: visibleFolders(can).length > 0,
    talks: can('talks.manage') && !own, access: can('users.manage'),
  }
  return (Object.keys(EMPLOYEE_SECTIONS) as EmployeeSection[]).filter(section => shown[section])
}

/** The tabs the viewer sees: each one that holds at least one section the viewer sees. */
export function employeeTabs(can: (key: PermissionKey) => boolean, own = false): EmployeeTab[] {
  const sections = employeeSections(can, own)
  return EMPLOYEE_TABS.filter(tab => sections.some(section => EMPLOYEE_SECTIONS[section] === tab))
}

function queryKey(query: unknown): string | null {
  return typeof query === 'string' ? query : Array.isArray(query) && typeof query[0] === 'string' ? query[0] : null
}

const isSection = (key: string | null): key is EmployeeSection => key !== null && Object.hasOwn(EMPLOYEE_SECTIONS, key)

/**
 * The tab to open: the one named by `?tab=` when the role sees it (a former tab key opens the tab that now holds its
 * section), the tab of the requirements for the old anchor „#requirements“, otherwise the first one.
 */
export function requestedEmployeeTab(query: unknown, hash: string, visible: readonly EmployeeTab[]): EmployeeTab {
  const wanted = queryKey(query)
  const tab = isSection(wanted) ? EMPLOYEE_SECTIONS[wanted] : visible.find(key => key === wanted)
  if (tab && visible.includes(tab)) return tab
  if (hash === '#requirements' && visible.includes('records')) return 'records'
  return visible[0] ?? 'master'
}

/**
 * The section a former tab key in `?tab=` names, to scroll to: only when the viewer sees it and it is not the first
 * section of its tab (that one is at the top anyway).
 */
export function requestedEmployeeSection(query: unknown, visible: readonly EmployeeSection[]): EmployeeSection | null {
  const wanted = queryKey(query)
  if (!isSection(wanted) || !visible.includes(wanted)) return null
  const first = visible.find(section => EMPLOYEE_SECTIONS[section] === EMPLOYEE_SECTIONS[wanted])
  return first === wanted ? null : wanted
}
