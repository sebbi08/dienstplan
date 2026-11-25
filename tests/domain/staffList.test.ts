import { describe, expect, it } from 'vitest'
import {
  employeeSections, employeeTabs, requestedEmployeeSection, requestedEmployeeTab, staffBadges, suggestUsername,
} from '../../app/utils/staffList'
import { effectivePermissions } from '../../shared/domain/permissionBundles'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

const person = (overrides: Partial<{ hasPin: boolean; pinLocked: boolean; qualification: 'fachkraft' | null }> = {}) => ({
  hasPin: true, pinLocked: false, qualification: 'fachkraft' as const, ...overrides,
})
const fine = { hasAccount: true }

describe('staffBadges', () => {
  it('shows nothing when everything is there', () => {
    expect(staffBadges(person(), fine)).toEqual([])
  })

  it('flags a missing PIN, but not a lock of a PIN that is not there', () => {
    expect(staffBadges(person({ hasPin: false, pinLocked: true }), fine)).toEqual(['pinMissing'])
    expect(staffBadges(person({ pinLocked: true }), fine)).toEqual(['pinLocked'])
  })

  it('flags qualification and access in a fixed order', () => {
    expect(staffBadges(person({ hasPin: false, qualification: null }), { hasAccount: false }))
      .toEqual(['pinMissing', 'qualificationMissing', 'noAccess'])
  })
})

describe('suggestUsername', () => {
  it('writes the name in lower case without spaces and umlauts', () => {
    expect(suggestUsername('Jana Müller')).toBe('janamueller')
    expect(suggestUsername('  Ömer Özdemir ')).toBe('oemeroezdemir')
    expect(suggestUsername('Jörg Weiß-Übel')).toBe('joergweissuebel')
    expect(suggestUsername('ÄRZTIN')).toBe('aerztin')
  })

  it('drops other accents and characters', () => {
    expect(suggestUsername('René D’Angelo')).toBe('renedangelo')
    // Already decomposed umlauts (as some keyboards send them) count as umlauts, too.
    expect(suggestUsername('Mu\u0308ller')).toBe('mueller')
  })

  it('adds a number when the name is taken', () => {
    expect(suggestUsername('Jana Müller', ['JanaMueller'])).toBe('janamueller2')
    expect(suggestUsername('Jana Müller', ['janamueller', 'janamueller2'])).toBe('janamueller3')
  })

  it('is empty when nothing usable is left', () => {
    expect(suggestUsername('  ')).toBe('')
    expect(suggestUsername('–')).toBe('')
  })
})

describe('employee page tabs', () => {
  /** The role's default permissions, as the session hands them over. */
  const canOf = (role: Role) => {
    const permissions = effectivePermissions({ role })
    return (key: PermissionKey) => permissions.has(key)
  }
  const allSections = [
    'master', 'qualification', 'contract', 'parentalLeave', 'payroll', 'hours', 'balance', 'leave', 'stamping',
    'requiredDocuments', 'requirements', 'documents', 'accidents', 'bem', 'maternity', 'sickDays', 'talks', 'access',
  ]
  const allTabs = ['master', 'contract', 'times', 'records', 'health', 'talks', 'access']
  const withoutContract = (sections: string[]) => sections.filter(section => !['contract', 'parentalLeave', 'payroll'].includes(section))

  it('shows the Träger every section, the Leitung all but the contract data, „Zugang“ and „Gespräche“ to nobody else', () => {
    expect(employeeSections(canOf('provider'))).toEqual(allSections)
    expect(employeeSections(canOf('admin'))).toEqual(withoutContract(allSections))
    expect(employeeSections(canOf('observer'))).not.toContain('access')
    expect(employeeSections(canOf('observer'))).not.toContain('talks')
    // Nobody manages a talk about themselves: no „Gespräche“ on the own page.
    expect(employeeSections(canOf('admin'), true)).not.toContain('talks')
    expect(employeeSections(canOf('provider'), true)).not.toContain('talks')
    // BEM, Mutterschutz and Krankheitstage with the sick days right (Leitung and Träger), never on the own page.
    for (const section of ['bem', 'maternity', 'sickDays']) {
      expect(employeeSections(canOf('admin'), true), section).not.toContain(section)
      expect(employeeSections(canOf('provider'), true), section).not.toContain(section)
      expect(employeeSections(canOf('admin')), section).toContain(section)
      expect(employeeSections(canOf('observer')), section).not.toContain(section)
      expect(employeeSections(canOf('group_lead')), section).not.toContain(section)
    }
    expect(employeeSections(() => false)).not.toContain('access')
  })

  it('shows the contract data with employees.contractView, „Lohn und Steuer“ with employees.payroll, the documents with any folder key', () => {
    expect(employeeSections(canOf('observer'))).not.toContain('documents')
    expect(employeeSections(canOf('observer'))).not.toContain('requiredDocuments')
    expect(employeeSections(canOf('observer'))).not.toContain('payroll')
    expect(employeeSections(key => key === 'employees.docs.salary')).toEqual(expect.arrayContaining(['requiredDocuments', 'documents']))
    // „Unfälle“ with accidents.manage (the Leitung by default), not for staff.
    expect(employeeSections(key => key === 'accidents.manage')).toContain('accidents')
    expect(employeeSections(canOf('observer'))).not.toContain('accidents')
    expect(employeeSections(key => key === 'employees.payroll'))
      .toEqual(['master', 'qualification', 'payroll', 'hours', 'balance', 'leave', 'stamping', 'requirements'])
    expect(employeeSections(key => key === 'employees.contractView'))
      .toEqual(['master', 'qualification', 'contract', 'parentalLeave', 'hours', 'balance', 'leave', 'stamping', 'requirements'])
  })

  it('shows the seven tabs, without a tab none of whose sections the viewer sees', () => {
    expect(employeeTabs(canOf('provider'))).toEqual(allTabs)
    // The Leitung by default: no contract data, so no „Vertrag & Lohn“.
    expect(employeeTabs(canOf('admin'))).toEqual(allTabs.filter(tab => tab !== 'contract'))
    expect(employeeTabs(() => false)).toEqual(['master', 'times', 'records'])
    expect(employeeTabs(canOf('admin'), true)).toEqual(['master', 'times', 'records', 'health', 'access'])
    // On the own page „Gesundheit“ holds only the accidents.
    expect(employeeTabs(key => key === 'employees.sickness', true)).not.toContain('health')
    expect(employeeTabs(canOf('provider'), true)).not.toContain('talks')
    expect(employeeTabs(canOf('observer'))).not.toContain('access')
    expect(employeeTabs(canOf('observer'))).not.toContain('health')
  })

  it('opens the tab of the address, the tab of a former tab or section key, the requirements for the old anchor, else the first', () => {
    const visible = employeeTabs(canOf('provider'))
    expect(requestedEmployeeTab('access', '', visible)).toBe('access')
    expect(requestedEmployeeTab(['times'], '', visible)).toBe('times')
    expect(requestedEmployeeTab('talks', '', visible)).toBe('talks')
    expect(requestedEmployeeTab('health', '', visible)).toBe('health')
    expect(requestedEmployeeTab(undefined, '#requirements', visible)).toBe('records')
    expect(requestedEmployeeTab('nonsense', '', visible)).toBe('master')
    expect(requestedEmployeeTab('toString', '', visible)).toBe('master')
    expect(requestedEmployeeTab('access', '', employeeTabs(canOf('observer')))).toBe('master')
    // Former keys (setup checklist, reminders, the accident overview, older links) open the tab that holds them now.
    expect(Object.fromEntries(['qualification', 'contract', 'hours', 'payroll', 'leave', 'stamping', 'requirements', 'documents',
      'accidents', 'bem', 'maternity', 'records'].map(key => [key, requestedEmployeeTab(key, '', visible)]))).toEqual({
      qualification: 'master', contract: 'contract', hours: 'times', payroll: 'contract', leave: 'times', stamping: 'times',
      requirements: 'records', documents: 'records', accidents: 'health', bem: 'health', maternity: 'health', records: 'records',
    })
    // Not seen: the first tab (the Leitung has no contract data by default, nobody a talk about themselves).
    expect(requestedEmployeeTab('contract', '', employeeTabs(canOf('admin')))).toBe('master')
    expect(requestedEmployeeTab('talks', '', employeeTabs(canOf('admin'), true))).toBe('master')
    expect(requestedEmployeeTab('bem', '', employeeTabs(canOf('observer')))).toBe('master')
  })

  it('scrolls to the section of a former key unless it is the first of its tab or not shown', () => {
    const visible = employeeSections(canOf('provider'))
    expect(requestedEmployeeSection('qualification', visible)).toBe('qualification')
    expect(requestedEmployeeSection('stamping', visible)).toBe('stamping')
    expect(requestedEmployeeSection(['payroll'], visible)).toBe('payroll')
    expect(requestedEmployeeSection('documents', visible)).toBe('documents')
    expect(requestedEmployeeSection('bem', visible)).toBe('bem')
    expect(requestedEmployeeSection('hours', visible)).toBeNull()
    expect(requestedEmployeeSection('accidents', visible)).toBeNull()
    expect(requestedEmployeeSection('master', visible)).toBeNull()
    expect(requestedEmployeeSection('contract', visible)).toBeNull()
    expect(requestedEmployeeSection(undefined, visible)).toBeNull()
    expect(requestedEmployeeSection('payroll', employeeSections(canOf('admin')))).toBeNull()
  })
})
