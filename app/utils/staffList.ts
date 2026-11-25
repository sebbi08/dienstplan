import type { PermissionKey } from '#shared/domain/permissions'
import type { EmployeeListItemDto } from '#shared/types/api'
import { visibleFolders } from './personnel'

/** What the compact staff list flags at a person, in this order. */
export type StaffBadge = 'pinMissing' | 'pinLocked' | 'qualificationMissing' | 'noAccess'

/**
 * The small badges of one row of the staff list: no stamp PIN (not on the tablet), a PIN that is locked right now, no
 * qualification for the staffing ratio and no account linked to the person (open mandatory appointments have their own
 * column).
 */
export function staffBadges(
  employee: Pick<EmployeeListItemDto, 'hasPin' | 'pinLocked' | 'qualification'>,
  context: { hasAccount: boolean },
): StaffBadge[] {
  const badges: StaffBadge[] = []
  if (!employee.hasPin) badges.push('pinMissing')
  else if (employee.pinLocked) badges.push('pinLocked')
  if (employee.qualification === null) badges.push('qualificationMissing')
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
export const EMPLOYEE_TABS = ['master', 'contract', 'times', 'records', 'health', 'talks', 'access'] as const
export type EmployeeTab = typeof EMPLOYEE_TABS[number]

/**
 * The sections of the employee page whose showing depends on the viewer, in their order, each with its tab:
 * „Stammdaten“ | „Vertrag & Lohn“ (Vertragsangaben with Probezeit, Elternzeit, Lohn und Steuer) | „Zeiten & Urlaub“
 * (Wochenstunden, Stundenkonto, Urlaub with Zusatztagen, PIN and Stempeln) | „Nachweise“ (Pflichtdokumente,
 * Pflichttermine und Fortbildungen, Personalakte) | „Gesundheit“ (Unfälle, BEM, Mutterschutz, Krankheitstage) |
 * „Gespräche“ | „Zugang“. The keys include every former tab and section key: a link with an old `?tab=` (e.g.
 * `?tab=stamping`, `?tab=bem`, `?tab=hours`) still opens the tab that holds it now.
 */
export const EMPLOYEE_SECTIONS = {
  master: 'master', qualification: 'master',
  contract: 'contract', parentalLeave: 'contract', payroll: 'contract',
  hours: 'times', balance: 'times', leave: 'times', stamping: 'times',
  requiredDocuments: 'records', requirements: 'records', documents: 'records',
  accidents: 'health', bem: 'health', maternity: 'health', sickDays: 'health',
  talks: 'talks', access: 'access',
} as const satisfies Record<string, EmployeeTab>
export type EmployeeSection = keyof typeof EMPLOYEE_SECTIONS

/**
 * The sections the viewer sees on the employee page (reached with employees.view; „Zugang“ uses the users' routes and
 * needs users.manage, „Gespräche“ the staff talk routes and talks.manage, „Vertragsangaben“ and „Elternzeit“
 * employees.contractView, „Lohn und Steuer“ employees.payroll, „Pflichtdokumente“ and „Dokumente“ the key of at least
 * one folder, „Unfälle“ accidents.manage, „BEM“, „Mutterschutz“ and „Krankheitstage“ employees.sickness). On their own
 * page (`own`) nobody gets „Gespräche“, „BEM“, „Mutterschutz“ or „Krankheitstage“: a Leitung's talks and health matters
 * are held by the Träger (or another Leitung); they see the talks under „Meine Gespräche“.
 */
export function employeeSections(can: (key: PermissionKey) => boolean, own = false): EmployeeSection[] {
  const documents = visibleFolders(can).length > 0
  const health = can('employees.sickness') && !own
  const shown: Record<EmployeeSection, boolean> = {
    master: true, qualification: true,
    contract: can('employees.contractView'), parentalLeave: can('employees.contractView'), payroll: can('employees.payroll'),
    hours: true, balance: true, leave: true, stamping: true,
    requiredDocuments: documents, requirements: true, documents,
    accidents: can('accidents.manage'), bem: health, maternity: health, sickDays: health,
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
