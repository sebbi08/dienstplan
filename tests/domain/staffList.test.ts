import { describe, expect, it } from 'vitest'
import { employeeTabs, requestedEmployeeTab, staffBadges, suggestUsername } from '../../app/utils/staffList'
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
  const all = ['master', 'hours', 'leave', 'stamping', 'qualification', 'requirements', 'documents', 'payroll', 'talks', 'access']
  const withoutPayroll = all.filter(tab => tab !== 'payroll')

  it('shows the Träger every tab, the Leitung all but „Lohn und Steuer“, „Zugang“ and „Gespräche“ to nobody else', () => {
    expect(employeeTabs(canOf('admin'))).toEqual(withoutPayroll)
    expect(employeeTabs(canOf('provider'))).toEqual(all)
    expect(employeeTabs(canOf('observer'))).not.toContain('access')
    expect(employeeTabs(canOf('observer'))).not.toContain('talks')
    // Nobody manages a talk about themselves: no „Gespräche“ on the own page.
    expect(employeeTabs(canOf('admin'), true)).toEqual(withoutPayroll.filter(tab => tab !== 'talks'))
    expect(employeeTabs(canOf('provider'), true)).not.toContain('talks')
    expect(employeeTabs(() => false)).not.toContain('access')
  })

  it('shows „Dokumente“ with the key of any folder, „Lohn und Steuer“ only with employees.payroll', () => {
    expect(employeeTabs(canOf('observer'))).not.toContain('documents')
    expect(employeeTabs(canOf('observer'))).not.toContain('payroll')
    expect(employeeTabs(key => key === 'employees.docs.salary')).toContain('documents')
    expect(employeeTabs(key => key === 'employees.payroll')).toEqual(['master', 'hours', 'leave', 'stamping', 'qualification', 'requirements', 'payroll'])
  })

  it('opens the tab of the address, the requirements for the old anchor, else the first', () => {
    const visible = employeeTabs(canOf('admin'))
    expect(requestedEmployeeTab('access', '', visible)).toBe('access')
    expect(requestedEmployeeTab(['leave'], '', visible)).toBe('leave')
    expect(requestedEmployeeTab('talks', '', visible)).toBe('talks')
    expect(requestedEmployeeTab(undefined, '#requirements', visible)).toBe('requirements')
    expect(requestedEmployeeTab('nonsense', '', visible)).toBe('master')
    expect(requestedEmployeeTab('access', '', employeeTabs(canOf('observer')))).toBe('master')
    expect(requestedEmployeeTab('payroll', '', visible)).toBe('master')
    expect(requestedEmployeeTab('payroll', '', employeeTabs(canOf('provider')))).toBe('payroll')
  })
})
