import { describe, expect, it } from 'vitest'
import { employeeTabs, requestedEmployeeTab, staffBadges, suggestUsername } from '../../app/utils/staffList'

const person = (overrides: Partial<{ hasPin: boolean; pinLocked: boolean; qualification: 'educator' | null }> = {}) => ({
  hasPin: true, pinLocked: false, qualification: 'educator' as const, ...overrides,
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
    expect(suggestUsername('Müller')).toBe('mueller')
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
  const all = ['master', 'hours', 'leave', 'stamping', 'qualification', 'requirements', 'access']

  it('shows every tab to Leitung and Träger, „Zugang“ to nobody else', () => {
    expect(employeeTabs('admin')).toEqual(all)
    expect(employeeTabs('provider')).toEqual(all)
    expect(employeeTabs('observer')).not.toContain('access')
    expect(employeeTabs(null)).not.toContain('access')
  })

  it('opens the tab of the address, the requirements for the old anchor, else the first', () => {
    const visible = employeeTabs('admin')
    expect(requestedEmployeeTab('access', '', visible)).toBe('access')
    expect(requestedEmployeeTab(['leave'], '', visible)).toBe('leave')
    expect(requestedEmployeeTab(undefined, '#requirements', visible)).toBe('requirements')
    expect(requestedEmployeeTab('nonsense', '', visible)).toBe('master')
    expect(requestedEmployeeTab('access', '', employeeTabs('observer'))).toBe('master')
  })
})
