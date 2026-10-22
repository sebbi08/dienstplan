import { describe, expect, it } from 'vitest'
import { GERMAN_STATES, type GermanState } from '../../shared/domain/states'
import {
  facilityAddOns, hasPeriodCheck, meets, plannedFte, quotaLines, requiredFte, ruleSetProblems,
} from '../../shared/domain/staffing/calc'
import { presenceShortfalls } from '../../shared/domain/staffing/presence'
import { presetFor, presetVersions } from '../../shared/domain/staffing/presets'
import type { Confidence, DemandChild, Phase, PresenceSlot, Qualification } from '../../shared/domain/staffing/types'

const kids = (n: number, child: DemandChild): DemandChild[] => Array.from({ length: n }, () => ({ ...child }))
const weeks = 30 / 7
const fullTime = (fteHours: number) => fteHours * weeks
const OCTOBER = '2026-10-01'

/** The day before an ISO date. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

describe('presets – every state', () => {
  it.each(GERMAN_STATES)('%s has a valid rule set for October 2026', (land) => {
    const rules = presetFor(land, OCTOBER)
    expect(rules.land).toBe(land)
    expect(ruleSetProblems(rules)).toEqual([])
  })

  it.each(GERMAN_STATES)('%s: every version is valid, sorted and found on its own date', (land) => {
    const versions = presetVersions(land)
    expect(versions.length).toBeGreaterThan(0)
    versions.forEach((version, i) => {
      expect(version.land).toBe(land)
      expect(ruleSetProblems(version)).toEqual([])
      expect(presetFor(land, version.validFrom)).toBe(version)
      if (i > 0) {
        expect(version.validFrom > versions[i - 1]!.validFrom).toBe(true)
        expect(presetFor(land, dayBefore(version.validFrom))).toBe(versions[i - 1])
      }
    })
  })

  it.each(GERMAN_STATES)('%s names its source, explains uncertain values and labels its group types', (land) => {
    for (const version of presetVersions(land)) {
      expect(version.source.trim()).not.toBe('')
      if (version.confidence !== 'high') expect(version.note?.trim()).toBeTruthy()
      const keys = (version.groupTypes ?? []).map(t => t.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const type of version.groupTypes ?? []) expect(type.label.trim()).not.toBe('')
    }
  })

  it('carries the confidence of the research', () => {
    const expected: Record<GermanState, Confidence> = {
      BW: 'high', BY: 'high', BE: 'high', BB: 'high', HB: 'high', HH: 'low', HE: 'high', MV: 'medium',
      NI: 'high', NW: 'high', RP: 'high', SL: 'low', SN: 'high', ST: 'medium', SH: 'medium', TH: 'medium',
    }
    for (const land of GERMAN_STATES) expect([land, presetFor(land, OCTOBER).confidence]).toEqual([land, expected[land]])
    // pending / announced changes without numbers yet: the hint „bitte prüfen“ appears from their date
    expect(presetFor('BB', '2027-01-01').confidence).toBe('medium')
    expect(presetFor('NW', '2027-08-01').confidence).toBe('low')
  })

  it('is read-only (overrides must build new objects)', () => {
    const rules = presetFor('BW', OCTOBER)
    expect(() => { (rules as { fteHoursPerWeek: number }).fteHoursPerWeek = 30 }).toThrow()
    expect(() => { rules.demand[0]!.ftePerGroup = 5 }).toThrow()
  })

  it('only Bremen is presence-only', () => {
    for (const land of GERMAN_STATES) expect([land, hasPeriodCheck(presetFor(land, OCTOBER))]).toEqual([land, land !== 'HB'])
  })
})

describe('presets – versions', () => {
  const ganztagU2 = { ageBand: 'u3' as const, weeklyHours: 40, ageMonths: 18 }
  const ganztag2to3 = { ageBand: 'u3' as const, weeklyHours: 40, ageMonths: 30 }
  const be = (date: string, child: DemandChild) =>
    requiredFte(presetFor('BE', date), { groupType: null, openingMinutesPerDay: null, children: [child] }).demandFte

  it('BE: July 2026 uses the transitional values, August the new ones (Review Focus 3)', () => {
    expect(be('2026-07-01', ganztagU2)).toBeCloseTo(1 / 3.25, 10)
    expect(be('2026-07-31', ganztag2to3)).toBeCloseTo(1 / 4.25, 10)
    expect(be('2026-08-01', ganztagU2)).toBeCloseTo(1 / 2.75, 10)
    expect(be('2026-08-01', ganztag2to3)).toBeCloseTo(1 / 3.75, 10)
    // until 2025 the old values
    expect(be('2025-12-31', ganztagU2)).toBeCloseTo(1 / 3.75, 10)
    expect(be('2025-12-31', ganztag2to3)).toBeCloseTo(1 / 4.75, 10)
    // Ü3 unchanged
    for (const date of ['2025-12-31', '2026-07-01', '2026-08-01']) {
      expect(be(date, { ageBand: 'ue3', weeklyHours: 40 })).toBeCloseTo(1 / 9, 10)
    }
  })

  it('SN: Krippe 4.6064 until 31.07.2026, 4.5014 from 01.08.2026 (Review Focus 3)', () => {
    const sn = (date: string, child: DemandChild) =>
      requiredFte(presetFor('SN', date), { groupType: null, openingMinutesPerDay: null, children: [child] }).demandFte
    expect(sn('2026-07-01', { ageBand: 'u3', weeklyHours: 45 })).toBeCloseTo(1 / 4.6064, 10)
    expect(sn('2026-08-01', { ageBand: 'u3', weeklyHours: 45 })).toBeCloseTo(1 / 4.5014, 10)
    expect(sn('2026-07-01', { ageBand: 'ue3', weeklyHours: 45 })).toBeCloseTo(1 / 10.5244, 10)
    expect(sn('2026-08-01', { ageBand: 'ue3', weeklyHours: 45 })).toBeCloseTo(1 / 10.5244, 10)
    // scaled linearly to the 9-h day (Hort: 6-h day)
    expect(sn('2026-08-01', { ageBand: 'u3', weeklyHours: 30 })).toBeCloseTo(30 / 45 / 4.5014, 10)
    expect(sn('2026-08-01', { ageBand: 'school', weeklyHours: 15 })).toBeCloseTo(15 / 30 / 20.473, 10)
  })

  it('falls back to the oldest version before the first date', () => {
    expect(presetFor('BE', '2000-01-01')).toBe(presetVersions('BE')[0])
    expect(presetFor('BW', '2000-01-01')).toBe(presetVersions('BW')[0])
  })
})

describe('presets – sample calculations', () => {
  it('BW Regelgruppe: 1.8 FTE, 2.0 with U3; two Fachkräfte + Azubi enough, one absent not (Review Focus 1)', () => {
    const bw = presetFor('BW', OCTOBER)
    const children = kids(25, { ageBand: 'ue3', weeklyHours: 30 })
    const required = requiredFte(bw, { groupType: 'regel', openingMinutesPerDay: 360, children })
    expect(required.fte).toBeCloseTo(1.8, 10)
    const withU3 = [...kids(24, { ageBand: 'ue3', weeklyHours: 30 }), { ageBand: 'u3' as const, weeklyHours: 30 }]
    expect(requiredFte(bw, { groupType: 'regel', openingMinutesPerDay: 360, children: withU3 }).fte).toBeCloseTo(2.0, 10)
    expect(requiredFte(bw, { groupType: 'ganztag', openingMinutesPerDay: 420, children }).fte).toBeCloseTo(2.3, 10)
    expect(requiredFte(bw, { groupType: 'krippe', openingMinutesPerDay: 420, children: kids(10, { ageBand: 'u3', weeklyHours: 35 }) }).fte)
      .toBeCloseTo(2.06, 10)

    const full = fullTime(bw.fteHoursPerWeek)
    const staff = [
      { qualification: 'fachkraft' as const, share: null, hours: full },
      { qualification: 'fachkraft' as const, share: null, hours: full },
      { qualification: 'azubi_2' as const, share: null, hours: full },
    ]
    const planned = plannedFte(bw, staff, weeks)
    expect(planned.fte).toBeCloseTo(2.0, 10)
    expect(meets(planned.fte, required.fte)).toBe(true)
    const oneAbsent = plannedFte(bw, [staff[0]!, { ...staff[1]!, hours: 0 }, staff[2]!], weeks)
    expect(meets(oneAbsent.fte, required.fte)).toBe(false)
  })

  it('BW Leitung: 6 h for one group plus 2 h for each further group, shown only', () => {
    const [line] = facilityAddOns(presetFor('BW', OCTOBER), { children: [], groupCount: 3, demandFte: 5 })
    expect(line).toMatchObject({ key: 'leitung', counts: false })
    expect(line!.fte * 39).toBeCloseTo(10, 10)
  })

  it('BW presence: 2 Fachkräfte in the Hauptbetreuungszeit, a Zusatzkraft is no Fachkraft (Review Focus 5)', () => {
    const bw = presetFor('BW', OCTOBER)
    const slots: PresenceSlot[] = []
    for (let minute = 390; minute < 510; minute += 15) {
      slots.push({
        minute,
        children: kids(12, { ageBand: 'ue3', weeklyHours: 35 }),
        staff: [{ qualification: 'fachkraft' }, { qualification: 'ergaenzung' }],
      })
    }
    const phase = (minute: number): Phase => (minute >= 420 && minute < 480 ? 'haupt' : 'rand')
    expect(presenceShortfalls(bw, slots, phase, 'ganztag')).toEqual([{ from: 420, to: 480, have: 1, need: 2, fachkraft: true }])
    // the Randzeit (and every group) needs at least one Fachkraft
    const noFk = slots.map(s => ({ ...s, staff: [{ qualification: 'ergaenzung' as Qualification }] }))
    expect(presenceShortfalls(bw, noFk, () => 'rand', 'regel')).toEqual([{ from: 390, to: 510, have: 0, need: 1, fachkraft: true }])
  })

  it('BY: (20×35 + 5×35×2) ÷ 11 staff hours, Fachkraftquote ≥ 50 % (Review Focus 2)', () => {
    const by = presetFor('BY', OCTOBER)
    const children = [...kids(20, { ageBand: 'ue3', weeklyHours: 35 }), ...kids(5, { ageBand: 'u3', weeklyHours: 35 })]
    const required = requiredFte(by, { groupType: null, openingMinutesPerDay: null, children })
    expect(required.fte).toBeCloseTo((20 * 35 + 5 * 35 * 2) / 11 / by.fteHoursPerWeek, 10)
    const school = requiredFte(by, { groupType: null, openingMinutesPerDay: null, children: [{ ageBand: 'school', weeklyHours: 11 }] })
    expect(school.fte).toBeCloseTo(1.2 / by.fteHoursPerWeek, 10)
    const full = fullTime(by.fteHoursPerWeek)
    const low = plannedFte(by, [
      { qualification: 'fachkraft', share: null, hours: full },
      { qualification: 'ergaenzung', share: null, hours: 2 * full },
    ], weeks)
    const [quota] = quotaLines(by, required, low)
    expect(quota).toMatchObject({ kind: 'min_share', ok: false })
    expect(quota!.limit).toBeCloseTo(required.fte / 2, 10)
    const enough = plannedFte(by, [{ qualification: 'fachkraft', share: null, hours: 2 * full }], weeks)
    expect(quotaLines(by, required, enough)[0]!.ok).toBe(true)
  })

  it('BE (from 01.08.2026): by age and Betreuungsumfang, erweitert supplement, Leitung per child', () => {
    const be = presetFor('BE', OCTOBER)
    expect(be.fteHoursPerWeek).toBe(38.5)
    const children: DemandChild[] = [
      { ageBand: 'u3', weeklyHours: 40, ageMonths: 18 }, // under 2, Ganztag
      { ageBand: 'u3', weeklyHours: 30, ageMonths: 18 }, // under 2, Teilzeit
      { ageBand: 'u3', weeklyHours: 22, ageMonths: 30 }, // 2–3, Halbtag
      { ageBand: 'ue3', weeklyHours: 50 }, // Ganztag + erweitert
      { ageBand: 'ue3', weeklyHours: 30 }, // Teilzeit
      { ageBand: 'ue3', weeklyHours: 20 }, // Halbtag
    ]
    const r = requiredFte(be, { groupType: null, openingMinutesPerDay: null, children })
    const demand = 1 / 2.75 + 1 / 4 + 1 / 7 + 1 / 9 + 1 / 11 + 1 / 14
    expect(r.unmatchedChildren).toBe(0)
    expect(r.demandFte).toBeCloseTo(demand, 10)
    expect(r.fte).toBeCloseTo(demand + 0.015, 10)
    const leitung = facilityAddOns(be, { children, groupCount: 1, demandFte: r.demandFte }).find(l => l.key === 'leitung')!
    expect(leitung.counts).toBe(false)
    expect(leitung.fte).toBeCloseTo(6 * 0.0118, 10)
  })

  it('NW Gruppenform I at 35 h: table hours, Fachkraft minimum, Leitung from the table only', () => {
    const nw = presetFor('NW', OCTOBER)
    expect(nw.addOns.some(a => a.key === 'leitung')).toBe(false)
    const r = requiredFte(nw, { groupType: 'gf1', openingMinutesPerDay: null, children: kids(20, { ageBand: 'ue3', weeklyHours: 35 }) })
    expect(r.fte).toBeCloseTo(99.5 / 39, 10)
    expect(r.fachkraftFte).toBeCloseTo(77 / 39, 10)
    expect(r.lines.find(l => l.key === 'leitung')).toMatchObject({ counts: false })
    expect(r.lines.find(l => l.key === 'leitung')!.fte).toBeCloseTo(7 / 39, 10)
    const gf2 = requiredFte(nw, { groupType: 'gf2', openingMinutesPerDay: null, children: kids(10, { ageBand: 'u3', weeklyHours: 45 }) })
    expect(gf2.fte).toBeCloseTo(137.5 / 39, 10)
    const gf3 = requiredFte(nw, { groupType: 'gf3', openingMinutesPerDay: null, children: kids(25, { ageBand: 'ue3', weeklyHours: 25 }) })
    expect(gf3.fte).toBeCloseTo(71 / 39, 10)
    const planned = plannedFte(nw, [{ qualification: 'fachkraft', share: null, hours: fullTime(39) }], weeks)
    expect(quotaLines(nw, r, planned)[0]).toMatchObject({ kind: 'demand_minimum', ok: false })
  })

  it('HB: presence only, by group type, with a baseline for groups without type', () => {
    const hb = presetFor('HB', OCTOBER)
    expect(hb.quotas).toEqual([])
    expect(requiredFte(hb, { groupType: 'krippe', openingMinutesPerDay: 480, children: kids(10, { ageBand: 'u3', weeklyHours: 40 }) }).periodCheck)
      .toBe(false)
    const slot = (n: number, staff: Qualification[]): PresenceSlot[] => [{
      minute: 480, children: kids(n, { ageBand: 'u3', weeklyHours: 40 }), staff: staff.map(qualification => ({ qualification })),
    }]
    expect(presenceShortfalls(hb, slot(10, ['fachkraft', 'ergaenzung']), () => 'always', 'krippe')).toEqual([])
    // 11 children in a Krippe: two pairs (4 Kräfte, 2 of them Fachkräfte)
    expect(presenceShortfalls(hb, slot(11, ['fachkraft', 'ergaenzung']), () => 'always', 'krippe')).toEqual([
      { from: 480, to: 495, have: 1, need: 2, fachkraft: true },
      { from: 480, to: 495, have: 2, need: 4, fachkraft: false },
    ])
    expect(presenceShortfalls(hb, slot(20, ['fachkraft']), () => 'always', null)).toEqual([])
    expect(presenceShortfalls(hb, slot(21, ['fachkraft']), () => 'always', 'kindergarten')).toEqual([
      { from: 480, to: 495, have: 1, need: 2, fachkraft: true },
    ])
  })

  it('SH presence: one Kraft per started 15 children (U3 double), at least 2, one Fachkraft', () => {
    const sh = presetFor('SH', OCTOBER)
    const slot = (ue3: number, u3: number, staff: Qualification[]): PresenceSlot[] => [{
      minute: 480,
      children: [...kids(ue3, { ageBand: 'ue3', weeklyHours: 35 }), ...kids(u3, { ageBand: 'u3', weeklyHours: 35 })],
      staff: staff.map(qualification => ({ qualification })),
    }]
    expect(presenceShortfalls(sh, slot(5, 0, ['fachkraft', 'ergaenzung']), () => 'always')).toEqual([])
    expect(presenceShortfalls(sh, slot(5, 0, ['fachkraft']), () => 'always')).toEqual([
      { from: 480, to: 495, have: 1, need: 2, fachkraft: false },
    ])
    // 20 Ü3 + 6 U3 = 32 weighted → 3 Kräfte
    expect(presenceShortfalls(sh, slot(20, 6, ['fachkraft', 'ergaenzung']), () => 'always')).toEqual([
      { from: 480, to: 495, have: 2, need: 3, fachkraft: false },
    ])
  })

  it('HE: Mittelwert bands, Ausfall 22 % counts, Leitung 20 % capped at 1.5 FTE for the facility', () => {
    const he = presetFor('HE', OCTOBER)
    const children: DemandChild[] = [{ ageBand: 'u3', weeklyHours: 40 }, { ageBand: 'ue3', weeklyHours: 25 }, { ageBand: 'school', weeklyHours: 45 }]
    const r = requiredFte(he, { groupType: null, openingMinutesPerDay: null, children })
    const demand = (42.5 * 0.2 + 22.5 * 0.07 + 50 * 0.06) / 39
    expect(r.demandFte).toBeCloseTo(demand, 10)
    expect(r.fte).toBeCloseTo(demand * 1.22, 10)
    const leitung = facilityAddOns(he, { children, groupCount: 1, demandFte: 10 }).find(l => l.key === 'leitung')!
    expect(leitung).toMatchObject({ counts: false, fte: 1.5 })
  })

  it('RP: FTE per place at 7 h, scaled by the booked hours; 2 Fachkräfte present', () => {
    const rp = presetFor('RP', OCTOBER)
    const fte = (child: DemandChild) => requiredFte(rp, { groupType: null, openingMinutesPerDay: null, children: [child] }).demandFte
    expect(fte({ ageBand: 'u3', weeklyHours: 35, ageMonths: 20 })).toBeCloseTo(0.263, 10)
    expect(fte({ ageBand: 'u3', weeklyHours: 45, ageMonths: 30 })).toBeCloseTo(0.1 * 45 / 35, 10)
    expect(fte({ ageBand: 'school', weeklyHours: 35 })).toBeCloseTo(0.086, 10)
    const slots: PresenceSlot[] = [{ minute: 480, children: kids(3, { ageBand: 'ue3', weeklyHours: 35 }), staff: [{ qualification: 'fachkraft' }] }]
    expect(presenceShortfalls(rp, slots, () => 'always')).toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: true }])
  })

  it('BB: positions per divisor by hours band, Leitung base + steps, ≥ 80 % Fachkräfte', () => {
    const bb = presetFor('BB', OCTOBER)
    expect(bb.fteHoursPerWeek).toBe(40)
    const fte = (child: DemandChild) => requiredFte(bb, { groupType: null, openingMinutesPerDay: null, children: [child] }).demandFte
    expect(fte({ ageBand: 'u3', weeklyHours: 30 })).toBeCloseTo(0.8 / 4.25, 10)
    expect(fte({ ageBand: 'u3', weeklyHours: 40 })).toBeCloseTo(1 / 4.25, 10)
    expect(fte({ ageBand: 'school', weeklyHours: 20 })).toBeCloseTo(0.6 / 15, 10)
    expect(fte({ ageBand: 'school', weeklyHours: 25 })).toBeCloseTo(0.8 / 15, 10)
    const lines = facilityAddOns(bb, { children: [], groupCount: 3, demandFte: 6 })
    expect(lines.reduce((sum, l) => sum + l.fte, 0)).toBeCloseTo(0.0625 + 0.25, 10)
    expect(bb.quotas[0]).toMatchObject({ kind: 'min_share', pct: 80 })
  })
})
