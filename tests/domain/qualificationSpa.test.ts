import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { staffingPathLabel } from '../../app/utils/staffing'
import { QUALIFICATION_TITLES } from '../../shared/domain/accidents'
import { isFachkraft, plannedFte } from '../../shared/domain/staffing/calc'
import { presetFor, presetVersions } from '../../shared/domain/staffing/presets'
import { shares } from '../../shared/domain/staffing/presets/common'
import { QUALIFICATIONS } from '../../shared/domain/staffing/types'
import { GERMAN_STATES } from '../../shared/domain/states'
import { needsBirthYear } from '../../shared/domain/youthProtection'

const SPA = ['azubi_spa_1', 'azubi_spa_2', 'azubi_spa_3'] as const

describe('qualification – praxisintegrierte Ausbildung Sozialpädagogische Assistenz (SPA-PiA)', () => {
  it('adds azubi_spa_1/2/3 right after azubi_3, with German labels and accident titles', () => {
    expect(QUALIFICATIONS.slice(QUALIFICATIONS.indexOf('azubi_3'), QUALIFICATIONS.indexOf('studium_1')))
      .toEqual(['azubi_3', ...SPA])
    expect(de.staffing.qualifications.azubi_spa_1).toBe('PiA Sozialpädagogische Assistenz (1. Jahr)')
    expect(de.staffing.qualifications.azubi_spa_3).toBe('PiA Sozialpädagogische Assistenz (3. Jahr)')
    expect(QUALIFICATION_TITLES.azubi_spa_2).toBe('Auszubildende/r Sozialpädagogische Assistenz, praxisintegriert (2. Jahr)')
    expect(staffingPathLabel('staffShares.azubi_spa_2', presetVersions('BW')))
      .toBe('Anrechnung je Qualifikation: PiA Sozialpädagogische Assistenz (2. Jahr)')
  })

  it('counts 0 % by default and is a trainee for the Jugendarbeitsschutz (birth year prompt)', () => {
    expect(shares()).toMatchObject({ azubi_spa_1: 0, azubi_spa_2: 0, azubi_spa_3: 0 })
    for (const q of SPA) expect(needsBirthYear(q)).toBe(true)
  })

  it('counts in Baden-Württemberg from 01.11.2026 with 0 % in the 1st and 20 % in the 2nd and 3rd year (KM-FAQ KiTaG)', () => {
    const bw = presetFor('BW', '2026-11-01')
    expect([bw.staffShares.azubi_spa_1, bw.staffShares.azubi_spa_2, bw.staffShares.azubi_spa_3]).toEqual([0, 20, 20])
    expect(bw.source).toContain('https://km.baden-wuerttemberg.de/de/fruehe-bildung/kindertageseinrichtungen/faq-kindertagesbetreuungsgesetz')
    expect(isFachkraft(bw, 'azubi_spa_3')).toBe(false)
    const before = presetFor('BW', '2026-10-31')
    expect([before.staffShares.azubi_spa_1, before.staffShares.azubi_spa_2, before.staffShares.azubi_spa_3]).toEqual([0, 0, 0])
    // a full-time trainee in the 2nd year: 0.2 of a position
    const weeks = 30 / 7
    expect(plannedFte(bw, [{ qualification: 'azubi_spa_2', share: null, hours: 39 * weeks }], weeks).fte).toBeCloseTo(0.2, 10)
  })

  it('counts 0 % in the other states (no rule of theirs for these trainees)', () => {
    for (const land of GERMAN_STATES.filter(state => state !== 'BW')) {
      for (const version of presetVersions(land)) {
        expect([land, version.validFrom, SPA.map(q => version.staffShares[q])]).toEqual([land, version.validFrom, [0, 0, 0]])
      }
    }
  })

  it('tells Baden-Württemberg facilities that Kinderpfleger/innen and SPA are Fachkräfte (§ 7 Abs. 2 Nr. 6 KiTaG)', () => {
    expect(de.staffing.qualificationHintBw).toContain('§ 7 Abs. 2 Nr. 6 KiTaG')
    expect(de.staffing.qualificationHintBw).toContain('„Fachkraft“')
  })
})
