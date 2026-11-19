import { describe, expect, it } from 'vitest'
import { plannedFte } from '../../shared/domain/staffing/calc'
import { applyOverrides } from '../../shared/domain/staffing/overrides'
import { presetFor } from '../../shared/domain/staffing/presets'
import { shares } from '../../shared/domain/staffing/presets/common'
import { QUALIFICATIONS } from '../../shared/domain/staffing/types'
import { GERMAN_STATES } from '../../shared/domain/states'
import { staffBadges } from '../../app/utils/staffList'
import { de } from '../../app/locales/de'

describe('qualification Haushaltskraft', () => {
  it('is a qualification placed before none, with a German label', () => {
    expect(QUALIFICATIONS).toContain('haushalt')
    expect(QUALIFICATIONS.indexOf('haushalt')).toBe(QUALIFICATIONS.indexOf('none') - 1)
    expect(de.staffing.qualifications.haushalt).toBe('Haushaltskraft')
  })

  it('counts with 0 % by default in the shares helper and in every state preset', () => {
    expect(shares().haushalt).toBe(0)
    for (const land of GERMAN_STATES) expect(presetFor(land, '2026-10-01').staffShares.haushalt).toBe(0)
  })

  it('counts a Haushaltskraft with 0 FTE, unless a personal share overrides it', () => {
    const rules = presetFor('BW', '2026-10-01')
    const hours = rules.fteHoursPerWeek * 4
    const planned = plannedFte(rules, [{ qualification: 'haushalt', share: null, hours }], 4)
    expect(planned.fte).toBe(0)
    expect(planned.byQualification.haushalt).toBe(0)
    expect(planned.unqualifiedFte).toBe(0)
    expect(plannedFte(rules, [{ qualification: 'haushalt', share: 50, hours }], 4).fte).toBeCloseTo(0.5, 10)
  })

  it('falls back to the preset 0 when a stored override map knows nothing about haushalt', () => {
    const preset = presetFor('BW', '2026-10-01')
    const { rules, ignored } = applyOverrides(preset, { 'staffShares.fachkraft': { value: 90, preset: 100 } })
    expect(ignored).toEqual([])
    expect(rules.staffShares.haushalt).toBe(0)
    const raised = applyOverrides(preset, { 'staffShares.haushalt': { value: 20, preset: 0 } })
    expect(raised.rules.staffShares.haushalt).toBe(20)
  })

  it('does not show "Qualifikation fehlt" once haushalt is set', () => {
    const person = { hasPin: true, pinLocked: false }
    const context = { hasAccount: true }
    expect(staffBadges({ ...person, qualification: 'haushalt' }, context)).not.toContain('qualificationMissing')
    expect(staffBadges({ ...person, qualification: null }, context)).toContain('qualificationMissing')
  })
})
