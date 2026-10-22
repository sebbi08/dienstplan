import { describe, expect, it } from 'vitest'
import { GERMAN_STATES } from '../../shared/domain/states'
import { ruleSetProblems } from '../../shared/domain/staffing/calc'
import {
  applyOverrides, demandKey, overridableValues, presenceKey, type StaffingOverrides,
} from '../../shared/domain/staffing/overrides'
import { presetFor, presetVersions } from '../../shared/domain/staffing/presets'

const OCTOBER = '2026-10-01'
const valuesOf = (land: Parameters<typeof presetFor>[0]) =>
  Object.fromEntries(overridableValues(presetFor(land, OCTOBER)).map(v => [v.path, v.value]))

describe('staffing overrides – paths', () => {
  it('names every numeric value of a preset by a readable path', () => {
    const bw = valuesOf('BW')
    expect(bw).toMatchObject({
      'fteHoursPerWeek': 39,
      'staffShares.fachkraft': 100,
      'staffShares.ergaenzung': 0,
      'staffShares.azubi_1': 0,
      'demand.regel+mit-u3.ftePerGroup': 2,
      'demand.regel+mit-u3.refHoursPerDay': 6,
      'demand.regel.ftePerGroup': 1.8,
      'demand.krippe.ftePerGroup': 2.06,
      'addOns.leitung.firstGroupHours': 6,
      'addOns.leitung.hours': 2,
      'presence.always.minFachkraft': 1,
      'presence.haupt+voe,ganztag,krippe.minFachkraft': 2,
    })
    // Conditions select a row and are part of its key, not values.
    expect(Object.keys(bw).some(path => path.endsWith('.groupType') || path.endsWith('.withAgeBand'))).toBe(false)
  })

  it('covers quotas, bands, nested values and presence weights', () => {
    const by = valuesOf('BY')
    expect(Object.keys(by).some(path => path.startsWith('quotas.') && path.endsWith('.pct'))).toBe(true)
    const sh = valuesOf('SH')
    expect(sh).toMatchObject({
      'presence.always.minStaff': 2,
      'presence.always.perChildren.children': 15,
      'presence.always.childWeights.u3': 2,
    })
    const ni = valuesOf('NI')
    expect(ni).toMatchObject({
      'demand.krippe+ab11.ftePerGroup': 3,
      'demand.all.ftePerGroup': 2,
      'addOns.verfuegung.hours': 7.5,
      'presence.haupt+krippe+ab11.minStaff': 3,
    })
    const bb = valuesOf('BB')
    expect(bb).toMatchObject({ 'addOns.leitung.steps.bis4.fte': 0.125, 'addOns.leitung.steps.rest.fte': 0.5 })
    expect(Object.keys(bb).some(path => path.endsWith('.upTo'))).toBe(false)
    const nw = valuesOf('NW')
    expect(Object.keys(nw).some(path => path.includes('.weeklyHoursPerGroup.total'))).toBe(true)
  })

  it('keys demand rows by their conditions, without dots', () => {
    expect(demandKey({})).toBe('all')
    expect(demandKey({ groupType: 'regel', withAgeBand: 'u3' })).toBe('regel+mit-u3')
    expect(demandKey({ ageBand: 'u3', weeklyHours: { over: 22.5, upTo: 35 } })).toBe('u3+h>22,5<=35')
    expect(demandKey({ ageMonths: { below: 24 }, weeklyHours: { atLeast: 45 } })).toBe('m<24+h>=45')
    expect(presenceKey({ window: 'haupt', groupTypes: ['krippe'], minChildren: 11 })).toBe('haupt+krippe+ab11')
  })

  it.each(GERMAN_STATES)('%s: every version has unique paths with finite values', (land) => {
    for (const version of presetVersions(land)) {
      const paths = overridableValues(version).map(v => v.path)
      expect(new Set(paths).size).toBe(paths.length)
      for (const { value } of overridableValues(version)) expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('staffing overrides – applying', () => {
  const bw = presetFor('BW', OCTOBER)
  const override = (path: string, value: number): StaffingOverrides => {
    const preset = overridableValues(bw).find(v => v.path === path)!.value
    return { [path]: { value, preset } }
  }

  it('builds a new rule set and leaves the frozen preset as it is', () => {
    const { rules, applied, ignored } = applyOverrides(bw, {
      ...override('demand.regel.ftePerGroup', 2.1), ...override('staffShares.azubi_1', 50), ...override('fteHoursPerWeek', 40),
    })
    expect(rules).not.toBe(bw)
    expect(rules.demand[3]).toMatchObject({ groupType: 'regel', ftePerGroup: 2.1 })
    expect(rules.staffShares.azubi_1).toBe(50)
    expect(rules.fteHoursPerWeek).toBe(40)
    expect(applied.sort()).toEqual(['demand.regel.ftePerGroup', 'fteHoursPerWeek', 'staffShares.azubi_1'])
    expect(ignored).toEqual([])
    expect(bw.demand[3]!.ftePerGroup).toBe(1.8)
    expect(Object.isFrozen(bw.demand[3])).toBe(true)
    expect(ruleSetProblems(rules)).toEqual([])
  })

  it('without overrides answers the preset values', () => {
    const { rules, applied } = applyOverrides(bw, {})
    expect(rules).toEqual(bw)
    expect(applied).toEqual([])
  })

  it('ignores paths the version does not have and values the law changed since', () => {
    const { rules, applied, ignored } = applyOverrides(bw, {
      'demand.u3.childrenPerFte': { value: 3, preset: 4 },
      'demand.regel.ftePerGroup': { value: 2.5, preset: 1.7 },
      'fteHoursPerWeek': { value: 40, preset: 39 },
    })
    expect(applied).toEqual(['fteHoursPerWeek'])
    expect(ignored.sort()).toEqual(['demand.regel.ftePerGroup', 'demand.u3.childrenPerFte'])
    expect(rules.demand[3]!.ftePerGroup).toBe(1.8)
  })
})
