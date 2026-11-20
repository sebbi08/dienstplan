import { describe, expect, it } from 'vitest'
import {
  childSickDefaults, childSickEntitlement, childSickOutdated, childSickSettingsError, isEligibleChildInYear, isEligibleChildOn, parentStatus,
} from '../../shared/domain/childSickDays'

const child = (birthDate: string, disabledDependent = false) => ({ birthDate, disabledDependent })

describe('Kinderkrankentage: eligible children (§ 45 SGB V)', () => {
  it('counts a child that is under 12 on any day of the year', () => {
    // Turns 12 on 2 January 2026: under 12 on 1 January.
    expect(isEligibleChildInYear(child('2014-01-02'), 2026)).toBe(true)
    // Turns 12 on 1 January 2026: 12 from the first day.
    expect(isEligibleChildInYear(child('2014-01-01'), 2026)).toBe(false)
    expect(isEligibleChildInYear(child('2014-12-31'), 2026)).toBe(true)
    expect(isEligibleChildInYear(child('2010-06-01'), 2026)).toBe(false)
    // Born during the year: counts; born after it: not yet.
    expect(isEligibleChildInYear(child('2026-11-30'), 2026)).toBe(true)
    expect(isEligibleChildInYear(child('2027-01-01'), 2026)).toBe(false)
  })

  it('counts a disabled child dependent on help at any age', () => {
    expect(isEligibleChildInYear(child('2000-03-01', true), 2026)).toBe(true)
    expect(isEligibleChildOn(child('2000-03-01', true), '2026-11-19')).toBe(true)
  })

  it('offers on a day the children under 12 on that day', () => {
    expect(isEligibleChildOn(child('2014-11-20'), '2026-11-19')).toBe(true)
    expect(isEligibleChildOn(child('2014-11-19'), '2026-11-19')).toBe(false)
    expect(isEligibleChildOn(child('2026-11-20'), '2026-11-19')).toBe(false)
  })
})

describe('Kinderkrankentage: entitlement per year', () => {
  const settings = childSickDefaults(2026)

  it('has the raised values of § 45 Abs. 2a SGB V up to 2026 and the lasting ones of Abs. 2 from 2027', () => {
    expect(settings).toEqual({ perChild: 15, maxPerYear: 35, singleParentPerChild: 30, singleParentMax: 70 })
    expect(childSickDefaults(2024)).toEqual(settings)
    expect(childSickDefaults(2027)).toEqual({ perChild: 10, maxPerYear: 25, singleParentPerChild: 20, singleParentMax: 50 })
    expect(childSickDefaults(2030)).toEqual(childSickDefaults(2027))
    // A copy: changing it changes no later call.
    childSickDefaults(2027).perChild = 99
    expect(childSickDefaults(2027).perChild).toBe(10)
  })

  it('calls stored values outdated while one of them is the raised value of 2026 (they apply to every year)', () => {
    expect(childSickOutdated(settings)).toBe(true)
    expect(childSickOutdated({ perChild: 10, maxPerYear: 35, singleParentPerChild: 20, singleParentMax: 50 })).toBe(true)
    expect(childSickOutdated(childSickDefaults(2027))).toBe(false)
    // Own values of the Träger that never were the 2026 ones.
    expect(childSickOutdated({ perChild: 12, maxPerYear: 30, singleParentPerChild: 24, singleParentMax: 60 })).toBe(false)
  })

  it('gives per child up to the yearly maximum', () => {
    expect(childSickEntitlement([], false, 2026, settings)).toEqual({ eligibleChildren: 0, days: 0 })
    expect(childSickEntitlement([child('2020-01-01')], false, 2026, settings)).toEqual({ eligibleChildren: 1, days: 15 })
    expect(childSickEntitlement([child('2020-01-01'), child('2018-01-01')], false, 2026, settings).days).toBe(30)
    expect(childSickEntitlement([child('2020-01-01'), child('2018-01-01'), child('2016-01-01')], false, 2026, settings).days).toBe(35)
  })

  it('gives single parents the higher values', () => {
    expect(childSickEntitlement([child('2020-01-01')], true, 2026, settings).days).toBe(30)
    expect(childSickEntitlement([child('2020-01-01'), child('2018-01-01')], true, 2026, settings).days).toBe(60)
    expect(childSickEntitlement([child('2020-01-01'), child('2018-01-01'), child('2016-01-01')], true, 2026, settings).days).toBe(70)
  })

  it('leaves out children over 12 that are not disabled', () => {
    expect(childSickEntitlement([child('2010-01-01'), child('2001-01-01', true)], false, 2026, settings))
      .toEqual({ eligibleChildren: 1, days: 15 })
  })

  it('follows changed settings', () => {
    const changed = { perChild: 10, maxPerYear: 25, singleParentPerChild: 20, singleParentMax: 50 }
    expect(childSickEntitlement([child('2020-01-01'), child('2018-01-01'), child('2016-01-01')], false, 2026, changed).days).toBe(25)
    expect(childSickEntitlement([child('2020-01-01')], true, 2026, changed).days).toBe(20)
  })

  it('checks the settings: whole days 0–365, the maximum at least one child\'s days', () => {
    expect(childSickSettingsError(settings)).toBeNull()
    expect(childSickSettingsError({ ...settings, perChild: 1.5 })).toBe('child_sick_settings_invalid')
    expect(childSickSettingsError({ ...settings, maxPerYear: -1 })).toBe('child_sick_settings_invalid')
    expect(childSickSettingsError({ ...settings, singleParentMax: 400 })).toBe('child_sick_settings_invalid')
    expect(childSickSettingsError({ ...settings, maxPerYear: 10 })).toBe('child_sick_settings_invalid')
  })
})

describe('parent status for the Pflegeversicherung', () => {
  it('is a parent with any child, and counts the children under 25 today', () => {
    expect(parentStatus([], '2026-11-19')).toEqual({ parent: false, childrenUnder25: 0 })
    expect(parentStatus([child('1990-01-01')], '2026-11-19')).toEqual({ parent: true, childrenUnder25: 0 })
    expect(parentStatus([child('2001-11-20'), child('2001-11-19'), child('2010-05-05')], '2026-11-19'))
      .toEqual({ parent: true, childrenUnder25: 2 })
  })

  it('stops counting a child on its 25th birthday', () => {
    expect(parentStatus([child('2001-11-20')], '2026-11-19').childrenUnder25).toBe(1)
    expect(parentStatus([child('2001-11-20')], '2026-11-20').childrenUnder25).toBe(0)
  })

  it('does not count a child born after today yet', () => {
    expect(parentStatus([child('2026-12-24')], '2026-11-19')).toEqual({ parent: false, childrenUnder25: 0 })
  })
})
