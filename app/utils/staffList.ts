import { isManager } from '#shared/domain/roles'
import type { EmployeeListItemDto, Role } from '#shared/types/api'

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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
  if (!base) return ''
  const used = new Set(taken.map(username => username.trim().toLowerCase()))
  if (!used.has(base)) return base
  let number = 2
  while (used.has(`${base}${number}`)) number++
  return `${base}${number}`
}

/** The tabs of the employee page, in their order. */
export const EMPLOYEE_TABS = ['master', 'hours', 'leave', 'stamping', 'qualification', 'requirements', 'access'] as const
export type EmployeeTab = typeof EMPLOYEE_TABS[number]

/**
 * The tabs a role sees on the employee page (only Leitung and Träger reach it; „Zugang“ uses the users' routes, which
 * need the same roles). Every tab has content for them, the contract inside „Stunden & Vertrag“ follows its own switch.
 */
export function employeeTabs(role: Role | null): EmployeeTab[] {
  return EMPLOYEE_TABS.filter(tab => tab !== 'access' || isManager(role))
}

/**
 * The tab to open: the one named by `?tab=` when the role sees it, the requirements for the old anchor „#requirements“,
 * otherwise the first one.
 */
export function requestedEmployeeTab(query: unknown, hash: string, visible: readonly EmployeeTab[]): EmployeeTab {
  const wanted = typeof query === 'string' ? query : Array.isArray(query) && typeof query[0] === 'string' ? query[0] : null
  const fromQuery = visible.find(tab => tab === wanted)
  if (fromQuery) return fromQuery
  if (hash === '#requirements' && visible.includes('requirements')) return 'requirements'
  return visible[0] ?? 'master'
}
