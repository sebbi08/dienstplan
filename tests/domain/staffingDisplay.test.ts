import { describe, expect, it } from 'vitest'
import { overridableValues } from '../../shared/domain/staffing/overrides'
import { presetFor, presetVersions } from '../../shared/domain/staffing/presets'
import { GERMAN_STATES } from '../../shared/domain/states'
import {
  demandTitle, formatDecimal, formatFte, formatSignedFte, parseDecimal, quotaLabel, staffingPathLabel, staffingSections,
} from '../../app/utils/staffing'

describe('staffing numbers', () => {
  it('shows FTE with two decimals and a comma', () => {
    expect(formatFte(1.8)).toBe('1,80')
    expect(formatFte(2)).toBe('2,00')
    expect(formatFte(0.2051)).toBe('0,21')
  })

  it('signs the difference, but not a rounded zero', () => {
    expect(formatSignedFte(0.2)).toBe('+0,20')
    expect(formatSignedFte(-0.8)).toBe('−0,80')
    expect(formatSignedFte(-0.001)).toBe('< −0,01')
    expect(formatSignedFte(0.004)).toBe('< +0,01')
    expect(formatSignedFte(-0.006)).toBe('−0,01')
    expect(formatSignedFte(1e-12)).toBe('0,00')
    expect(formatSignedFte(0)).toBe('0,00')
  })

  it('formats and parses preset values with a comma', () => {
    expect(formatDecimal(4.5014)).toBe('4,5014')
    expect(formatDecimal(1000)).toBe('1000')
    expect(parseDecimal('1,8')).toBe(1.8)
    expect(parseDecimal(' 2.06 ')).toBe(2.06)
    expect(parseDecimal('11')).toBe(11)
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('1,8,2')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
  })
})

describe('staffing settings sections', () => {
  it('labels every value of every version of every state, once and in the order of the paths', () => {
    for (const land of GERMAN_STATES) {
      for (const rules of presetVersions(land)) {
        const described = staffingSections(rules).flatMap(section => section.blocks.flatMap(block => block.fields.map(field => field.path)))
        const paths = overridableValues(rules).map(value => value.path)
        expect(new Set(described).size, `${land} ${rules.validFrom}`).toBe(described.length)
        expect([...described].sort(), `${land} ${rules.validFrom}`).toEqual([...paths].sort())
      }
    }
  })

  it('groups BW by group type with readable row titles', () => {
    const rules = presetFor('BW', '2026-10-01')
    const sections = staffingSections(rules)
    expect(sections.map(section => section.key)).toEqual(['demand', 'presence', 'shares', 'addOns', 'fte'])
    const demand = sections[0]!
    expect(demand.title).toBe('Bedarf je Gruppenart')
    expect(demand.blocks.map(block => block.title)).toContain('Regelgruppe, mit Kindern unter 3')
    const regel = demand.blocks.find(block => block.title === 'Regelgruppe')!
    expect(regel.fields.map(field => [field.path, field.label, field.unit])).toEqual([
      ['demand.regel.ftePerGroup', 'Vollzeitkräfte je Gruppe', ''],
      ['demand.regel.refHoursPerDay', 'bezogen auf eine Öffnungszeit von', 'Std./Tag'],
    ])
    const leitung = sections.find(section => section.key === 'addOns')!.blocks[0]!
    expect(leitung.title).toBe('Leitungszeit (nur angezeigt, nicht geprüft)')
    expect(leitung.fields.map(field => field.label)).toEqual(['für die erste Gruppe', 'für jede weitere Gruppe'])
  })

  it('groups BY by age band and shows the quota', () => {
    const sections = staffingSections(presetFor('BY', '2026-10-01'))
    expect(sections[0]!.title).toBe('Bedarf je Altersgruppe')
    expect(sections[0]!.blocks.map(block => block.title)).toEqual(['unter 3 Jahre', '3 Jahre bis Schule', 'Schulkinder'])
    const quotas = sections.find(section => section.key === 'quotas')!
    expect(quotas.blocks).toEqual([{ title: 'Fachkraftquote', fields: [{ path: 'quotas.fachkraftquote.pct', label: 'mindestens', unit: '%' }] }])
  })

  it('describes hours bands and months', () => {
    const rules = presetFor('HE', '2026-10-01')
    expect(demandTitle(rules, { ageBand: 'u3', weeklyHours: { over: 25, upTo: 35 } })).toBe('unter 3 Jahre, über 25 bis 35 Std./Woche')
    expect(demandTitle(rules, { ageBand: 'u3', ageMonths: { below: 12 } })).toBe('unter 3 Jahre, Alter unter 12 Monate')
    expect(demandTitle(rules, {})).toBe('alle')
  })

  it('labels a path for the notes, also from another version, and keeps unknown paths', () => {
    const versions = presetVersions('BB')
    expect(staffingPathLabel('fteHoursPerWeek', versions)).toBe('Vollzeit: Wochenstunden einer Vollzeitkraft')
    expect(staffingPathLabel('staffShares.praktikant', versions)).toBe('Anrechnung je Qualifikation: Praktikant/in')
    expect(staffingPathLabel('demand.nowhere.childrenPerFte', versions)).toBe('demand.nowhere.childrenPerFte')
  })
})

describe('quota labels', () => {
  it('builds the label from the effective percentage', () => {
    expect(quotaLabel({ label: 'Fachkraftquote', kind: 'min_share', pct: 50 })).toBe('Fachkraftquote mind. 50 %')
    expect(quotaLabel({ label: 'Fachkraftquote', kind: 'min_share', pct: 66.5 })).toBe('Fachkraftquote mind. 66,5 %')
    expect(quotaLabel({ label: 'Assistenzkräfte', kind: 'max_share', pct: 20 })).toBe('Assistenzkräfte höchstens 20 %')
    expect(quotaLabel({ label: 'Fachkraftstunden', kind: 'demand_minimum' })).toBe('Fachkraftstunden')
  })
})
