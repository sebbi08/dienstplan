import { describe, expect, it } from 'vitest'
import {
  employeeSections, employeeTabs, requestedEmployeeSection, requestedEmployeeTab, staffBadges, suggestUsername,
} from '../../app/utils/staffList'
import { effectivePermissions, type PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

const person = (overrides: Partial<{ hasPin: boolean; pinLocked: boolean; qualification: 'fachkraft' | null }> = {}) => ({
  hasPin: true, pinLocked: false, qualification: 'fachkraft' as const, ...overrides,
})
const fine = { requirementsOpen: false, hasAccount: true }

describe('staffBadges', () => {
  it('shows nothing when everything is there', () => {
    expect(staffBadges(person(), fine)).toEqual([])
  })

  it('flags a missing PIN, but not a lock of a PIN that is not there', () => {
    expect(staffBadges(person({ hasPin: false, pinLocked: true }), fine)).toEqual(['pinMissing'])
    expect(staffBadges(person({ pinLocked: true }), fine)).toEqual(['pinLocked'])
  })

  it('flags qualification, mandatory appointments and access in a fixed order', () => {
    expect(staffBadges(person({ hasPin: false, qualification: null }), { requirementsOpen: true, hasAccount: false }))
      .toEqual(['pinMissing', 'qualificationMissing', 'requirementsOpen', 'noAccess'])
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
    const permissions = effectivePermissions({ role, canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: false })
    return (key: PermissionKey) => permissions.has(key)
  }
  const allSections = ['master', 'qualification', 'hours', 'payroll', 'leave', 'stamping', 'requirements', 'documents', 'talks', 'access']
  const allTabs = ['master', 'contract', 'times', 'records', 'talks', 'access']

  it('shows the Träger every section, the Leitung all but „Lohn und Steuer“, „Zugang“ and „Gespräche“ to nobody else', () => {
    expect(employeeSections(canOf('admin'))).toEqual(allSections.filter(section => section !== 'payroll'))
    expect(employeeSections(canOf('provider'))).toEqual(allSections)
    expect(employeeSections(canOf('observer'))).not.toContain('access')
    expect(employeeSections(canOf('observer'))).not.toContain('talks')
    // Nobody manages a talk about themselves: no „Gespräche“ on the own page.
    expect(employeeSections(canOf('admin'), true)).not.toContain('talks')
    expect(employeeSections(canOf('provider'), true)).not.toContain('talks')
    expect(employeeSections(() => false)).not.toContain('access')
  })

  it('shows „Dokumente“ with the key of any folder, „Lohn und Steuer“ only with employees.payroll', () => {
    expect(employeeSections(canOf('observer'))).not.toContain('documents')
    expect(employeeSections(canOf('observer'))).not.toContain('payroll')
    expect(employeeSections(key => key === 'employees.docs.salary')).toContain('documents')
    expect(employeeSections(key => key === 'employees.payroll'))
      .toEqual(['master', 'qualification', 'hours', 'payroll', 'leave', 'stamping', 'requirements'])
  })

  it('shows the six tabs, without a tab none of whose sections the viewer sees', () => {
    expect(employeeTabs(canOf('provider'))).toEqual(allTabs)
    expect(employeeTabs(canOf('admin'))).toEqual(allTabs)
    // Without „Lohn und Steuer“ and „Dokumente“ their tabs stay for the other sections.
    expect(employeeTabs(() => false)).toEqual(['master', 'contract', 'times', 'records'])
    expect(employeeTabs(canOf('admin'), true)).toEqual(['master', 'contract', 'times', 'records', 'access'])
    expect(employeeTabs(canOf('provider'), true)).not.toContain('talks')
    expect(employeeTabs(canOf('observer'))).not.toContain('access')
  })

  it('opens the tab of the address, the tab of a former tab key, the requirements for the old anchor, else the first', () => {
    const visible = employeeTabs(canOf('admin'))
    expect(requestedEmployeeTab('access', '', visible)).toBe('access')
    expect(requestedEmployeeTab(['times'], '', visible)).toBe('times')
    expect(requestedEmployeeTab('talks', '', visible)).toBe('talks')
    expect(requestedEmployeeTab(undefined, '#requirements', visible)).toBe('records')
    expect(requestedEmployeeTab('nonsense', '', visible)).toBe('master')
    expect(requestedEmployeeTab('toString', '', visible)).toBe('master')
    expect(requestedEmployeeTab('access', '', employeeTabs(canOf('observer')))).toBe('master')
    // The former tab keys, e.g. from the setup checklist or the requirement notice.
    expect(requestedEmployeeTab('qualification', '', visible)).toBe('master')
    expect(requestedEmployeeTab(['hours'], '', visible)).toBe('contract')
    expect(requestedEmployeeTab('payroll', '', employeeTabs(canOf('provider')))).toBe('contract')
    expect(requestedEmployeeTab('leave', '', visible)).toBe('times')
    expect(requestedEmployeeTab('stamping', '', visible)).toBe('times')
    expect(requestedEmployeeTab('requirements', '', visible)).toBe('records')
    expect(requestedEmployeeTab('documents', '', visible)).toBe('records')
    expect(requestedEmployeeTab('talks', '', employeeTabs(canOf('admin'), true))).toBe('master')
  })

  it('scrolls to the section of a former tab key unless it is the first of its tab or not shown', () => {
    const visible = employeeSections(canOf('provider'))
    expect(requestedEmployeeSection('qualification', visible)).toBe('qualification')
    expect(requestedEmployeeSection('stamping', visible)).toBe('stamping')
    expect(requestedEmployeeSection(['payroll'], visible)).toBe('payroll')
    expect(requestedEmployeeSection('documents', visible)).toBe('documents')
    expect(requestedEmployeeSection('hours', visible)).toBeNull()
    expect(requestedEmployeeSection('master', visible)).toBeNull()
    expect(requestedEmployeeSection('contract', visible)).toBeNull()
    expect(requestedEmployeeSection(undefined, visible)).toBeNull()
    expect(requestedEmployeeSection('payroll', employeeSections(canOf('admin')))).toBeNull()
  })
})
