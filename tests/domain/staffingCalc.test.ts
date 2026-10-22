import { describe, expect, it } from 'vitest'
import {
  atMost, facilityAddOns, hasPeriodCheck, meets, plannedFte, quotaLines, requiredFte, ruleSetProblems,
} from '../../shared/domain/staffing/calc'
import type { DemandChild, StaffingRuleSet } from '../../shared/domain/staffing/types'

const shares = {
  fachkraft: 100, ergaenzung: 100, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, none: 0,
}
const base = (over: Partial<StaffingRuleSet>): StaffingRuleSet => ({
  land: 'BW', validFrom: '2026-01-01', source: 'test', confidence: 'high', method: 'group_fte',
  fteHoursPerWeek: 39, demand: [], addOns: [], presence: [], staffShares: shares, quotas: [], ...over,
})
const kids = (n: number, child: DemandChild): DemandChild[] => Array.from({ length: n }, () => ({ ...child }))

// --- group_fte (BW KiTaVO § 1) ---
const bw = base({
  land: 'BW', method: 'group_fte',
  groupTypes: [{ key: 'rg', label: 'Regelgruppe' }, { key: 'krippe', label: 'Kinderkrippe' }],
  demand: [
    { groupType: 'rg', withAgeBand: 'u3', ftePerGroup: 2.0, refHoursPerDay: 6 },
    { groupType: 'rg', ftePerGroup: 1.8, refHoursPerDay: 6 },
    { groupType: 'krippe', ftePerGroup: 2.06, refHoursPerDay: 7 },
  ],
  addOns: [{
    key: 'leitung', label: 'Leitungszeit', scope: 'facility', counts: false,
    mode: 'hours_per_group', firstGroupHours: 6, hours: 2,
  }],
})
const weeks = 30 / 7
const fullTime = 39 * weeks

describe('requiredFte – group_fte', () => {
  it('BW Regelgruppe with 25 children needs 1.8 FTE (Review Focus 1)', () => {
    const r = requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 360, children: kids(25, { ageBand: 'ue3', weeklyHours: 30 }) })
    expect(r.fte).toBeCloseTo(1.8, 10)
    expect(r.demandFte).toBeCloseTo(1.8, 10)
    expect(r.unmatchedChildren).toBe(0)
    expect(r.lines).toEqual([{ key: 'demand', label: 'Grundbedarf', fte: r.fte, counts: true }])
  })

  it('uses the "with U3" row when the group has a child under 3', () => {
    const children = [...kids(24, { ageBand: 'ue3', weeklyHours: 30 }), { ageBand: 'u3' as const, weeklyHours: 30 }]
    expect(requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 360, children }).fte).toBeCloseTo(2.0, 10)
  })

  it('scales with the opening hours and stays unscaled without them', () => {
    const children = kids(20, { ageBand: 'ue3', weeklyHours: 30 })
    expect(requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 450, children }).fte).toBeCloseTo(1.8 * 7.5 / 6, 10)
    expect(requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: null, children }).fte).toBeCloseTo(1.8, 10)
  })

  it('needs nothing without a group type (children unmatched) or without children', () => {
    const none = requiredFte(bw, { groupType: null, openingMinutesPerDay: 360, children: kids(3, { ageBand: 'ue3', weeklyHours: 30 }) })
    expect(none.fte).toBe(0)
    expect(none.unmatchedChildren).toBe(3)
    expect(requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 360, children: [] }).fte).toBe(0)
  })

  it('honours minChildren (NI Krippe: a 3rd Kraft from 11 children)', () => {
    const ni = base({
      method: 'group_fte',
      demand: [{ groupType: 'krippe', minChildren: 11, ftePerGroup: 3 }, { groupType: 'krippe', ftePerGroup: 2 }],
    })
    const at = (n: number) => requiredFte(ni, { groupType: 'krippe', openingMinutesPerDay: null, children: kids(n, { ageBand: 'u3', weeklyHours: 40 }) }).fte
    expect(at(10)).toBe(2)
    expect(at(11)).toBe(3)
  })
})

describe('plannedFte', () => {
  it('two full-time Fachkräfte and an Azubi at 0 % are 2.0 FTE – enough for 1.8 (Review Focus 1)', () => {
    const required = requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 360, children: kids(25, { ageBand: 'ue3', weeklyHours: 30 }) })
    const staff = [
      { qualification: 'fachkraft' as const, share: null, hours: fullTime },
      { qualification: 'fachkraft' as const, share: null, hours: fullTime },
      { qualification: 'azubi_2' as const, share: 0, hours: fullTime },
    ]
    const planned = plannedFte(bw, staff, weeks)
    expect(planned.fte).toBeCloseTo(2.0, 10)
    expect(planned.fachkraftFte).toBeCloseTo(2.0, 10)
    expect(planned.fte >= required.fte).toBe(true)
    // one Fachkraft absent the whole month: no planned hours
    const absent = plannedFte(bw, [staff[0]!, { ...staff[1]!, hours: 0 }, staff[2]!], weeks)
    expect(absent.fte).toBeCloseTo(1.0, 10)
    expect(absent.fte < required.fte).toBe(true)
  })

  it('uses the state default share unless the employee has an own share', () => {
    const planned = plannedFte(bw, [
      { qualification: 'azubi_3', share: null, hours: fullTime },
      { qualification: 'ergaenzung', share: 50, hours: fullTime },
      { qualification: 'none', share: null, hours: fullTime },
    ], weeks)
    expect(planned.fte).toBeCloseTo(0.5, 10)
    expect(planned.fachkraftFte).toBe(0)
    expect(planned.byQualification.ergaenzung).toBeCloseTo(0.5, 10)
    expect(planned.byQualification.azubi_3).toBe(0)
  })

  it('counts staff without a qualification fully (or at their share), never as Fachkraft', () => {
    const planned = plannedFte(bw, [{ qualification: null, share: null, hours: fullTime }, { qualification: null, share: 40, hours: fullTime }], weeks)
    expect(planned.fte).toBeCloseTo(1.4, 10)
    expect(planned.unqualifiedFte).toBeCloseTo(1.4, 10)
    expect(planned.fachkraftFte).toBe(0)
  })

  it('counts the configured Fachkraft qualifications (HH: 3rd year as Erstkraft)', () => {
    const hh = base({ fachkraftQualifications: ['fachkraft', 'azubi_3'], staffShares: { ...shares, azubi_3: 90 } })
    const planned = plannedFte(hh, [{ qualification: 'azubi_3', share: null, hours: fullTime }], weeks)
    expect(planned.fachkraftFte).toBeCloseTo(0.9, 10)
  })

  it('is zero for a period without weeks', () => {
    expect(plannedFte(bw, [{ qualification: 'fachkraft', share: null, hours: 10 }], 0).fte).toBe(0)
  })
})

// --- child_hours (BY AVBayKiBiG § 17, BayKiBiG Art. 21) ---
const by = base({
  land: 'BY', method: 'child_hours',
  demand: [
    { ageBand: 'u3', childWeight: 2.0, childHoursPerStaffHour: 11 },
    { ageBand: 'ue3', childWeight: 1.0, childHoursPerStaffHour: 11 },
    { ageBand: 'school', childWeight: 1.2, childHoursPerStaffHour: 11 },
  ],
  quotas: [{
    key: 'fachkraftquote', label: 'Fachkraftquote mind. 50 %', kind: 'min_share',
    qualifications: ['fachkraft'], pct: 50, base: 'required',
  }],
})

describe('requiredFte – child_hours', () => {
  const children = [...kids(20, { ageBand: 'ue3', weeklyHours: 35 }), ...kids(5, { ageBand: 'u3', weeklyHours: 35 })]

  it('BY: (20×35 + 5×35×2) ÷ 11 staff hours per week (Review Focus 2)', () => {
    const r = requiredFte(by, { groupType: null, openingMinutesPerDay: null, children })
    expect(r.fte).toBeCloseTo((20 * 35 + 5 * 35 * 2) / 11 / 39, 10)
  })

  it('BY Fachkraftquote ≥ 50 % of the required FTE (Review Focus 2)', () => {
    const required = requiredFte(by, { groupType: null, openingMinutesPerDay: null, children })
    const lowFk = plannedFte(by, [
      { qualification: 'fachkraft', share: null, hours: fullTime },
      { qualification: 'ergaenzung', share: null, hours: 2 * fullTime },
    ], weeks)
    const [line] = quotaLines(by, required, lowFk)
    expect(line).toMatchObject({ key: 'fachkraftquote', kind: 'min_share', ok: false })
    expect(line!.limit).toBeCloseTo(required.fte * 0.5, 10)
    expect(line!.have).toBeCloseTo(1.0, 10)
    const enough = plannedFte(by, [{ qualification: 'fachkraft', share: null, hours: 2 * fullTime }], weeks)
    expect(quotaLines(by, required, enough)[0]!.ok).toBe(true)
  })

  it('takes the higher of the row weight and the child weight', () => {
    const r = (weight: number) => requiredFte(by, { groupType: null, openingMinutesPerDay: null, children: [{ ageBand: 'u3', weeklyHours: 11, weight }] }).fte
    expect(r(4.5)).toBeCloseTo(4.5 / 39, 10)
    expect(r(1.3)).toBeCloseTo(2.0 / 39, 10)
  })

  it('HE: counted Mittelwert per band, factor per hour, Ausfall counts, Leitung capped and shown only', () => {
    const he = base({
      land: 'HE', method: 'child_hours',
      demand: [
        { ageBand: 'ue3', weeklyHours: { upTo: 25 }, countedWeeklyHours: 22.5, staffHoursPerChildHour: 0.07 },
        { ageBand: 'ue3', weeklyHours: { over: 25, upTo: 35 }, countedWeeklyHours: 30, staffHoursPerChildHour: 0.07 },
        { ageBand: 'ue3', weeklyHours: { over: 35, below: 45 }, countedWeeklyHours: 42.5, staffHoursPerChildHour: 0.07 },
        { ageBand: 'ue3', weeklyHours: { atLeast: 45 }, countedWeeklyHours: 50, staffHoursPerChildHour: 0.07 },
      ],
      addOns: [
        { key: 'ausfall', label: 'Ausfallzeiten', scope: 'group', counts: true, mode: 'pct_of_demand', pct: 22 },
        { key: 'leitung', label: 'Leitungszeit', scope: 'group', counts: false, mode: 'pct_of_demand', pct: 20, capFte: 0.1 },
      ],
    })
    const r = requiredFte(he, {
      groupType: null, openingMinutesPerDay: null,
      children: [{ ageBand: 'ue3', weeklyHours: 25 }, { ageBand: 'ue3', weeklyHours: 45 }, { ageBand: 'ue3', weeklyHours: 44 }],
    })
    const demand = (22.5 + 50 + 42.5) * 0.07 / 39
    expect(r.demandFte).toBeCloseTo(demand, 10)
    expect(r.fte).toBeCloseTo(demand * 1.22, 10)
    expect(r.lines.map(l => l.key)).toEqual(['demand', 'ausfall', 'leitung'])
    expect(r.lines[2]).toMatchObject({ counts: false })
    expect(r.lines[2]!.fte).toBeCloseTo(Math.min(demand * 0.2, 0.1), 10)
  })
})

// --- fte_per_child (BE KitaFöG § 11 from 01.08.2026) ---
const be = base({
  land: 'BE', method: 'fte_per_child', fteHoursPerWeek: 38.5,
  demand: [
    { ageBand: 'u3', ageMonths: { below: 24 }, weeklyHours: { over: 35 }, childrenPerFte: 2.75 },
    { ageBand: 'u3', weeklyHours: { over: 35 }, childrenPerFte: 3.75 },
    { ageBand: 'ue3', weeklyHours: { over: 35 }, childrenPerFte: 9 },
    { ageBand: 'ue3', weeklyHours: { over: 25, upTo: 35 }, childrenPerFte: 11 },
    { ageBand: 'ue3', weeklyHours: { atLeast: 20, upTo: 25 }, childrenPerFte: 14 },
  ],
  addOns: [
    { key: 'erweitert', label: 'Zuschlag erweiterte Betreuung', scope: 'group', counts: true, mode: 'fte_per_child', fte: 0.015, weeklyHours: { over: 45 } },
    { key: 'leitung', label: 'Leitungszeit', scope: 'group', counts: false, mode: 'fte_per_child', fte: 0.0118 },
  ],
})

describe('requiredFte – fte_per_child', () => {
  it('BE: by age (with months) and Betreuungsumfang, plus supplements', () => {
    const r = requiredFte(be, {
      groupType: null, openingMinutesPerDay: null,
      children: [
        { ageBand: 'u3', weeklyHours: 40, ageMonths: 18 },
        { ageBand: 'u3', weeklyHours: 40, ageMonths: 30 },
        { ageBand: 'u3', weeklyHours: 40 }, // no months: falls through to the 2–3 row
        { ageBand: 'ue3', weeklyHours: 50 },
        { ageBand: 'ue3', weeklyHours: 30 },
        { ageBand: 'ue3', weeklyHours: 25 },
        { ageBand: 'ue3', weeklyHours: 15 }, // below every band
      ],
    })
    const demand = 1 / 2.75 + 2 / 3.75 + 1 / 9 + 1 / 11 + 1 / 14
    expect(r.unmatchedChildren).toBe(1)
    expect(r.demandFte).toBeCloseTo(demand, 10)
    expect(r.fte).toBeCloseTo(demand + 0.015, 10)
    expect(r.lines.find(l => l.key === 'leitung')!.fte).toBeCloseTo(7 * 0.0118, 10)
  })

  it('BB fteUnits and RP linear hour scaling', () => {
    const bb = base({ method: 'fte_per_child', demand: [{ ageBand: 'ue3', weeklyHours: { upTo: 30 }, childrenPerFte: 10, fteUnits: 0.8 }] })
    expect(requiredFte(bb, { groupType: null, openingMinutesPerDay: null, children: kids(10, { ageBand: 'ue3', weeklyHours: 30 }) }).fte).toBeCloseTo(0.8, 10)
    const rp = base({ method: 'fte_per_child', demand: [{ ageBand: 'u3', childrenPerFte: 1 / 0.263, refHoursPerWeek: 35 }] })
    expect(requiredFte(rp, { groupType: null, openingMinutesPerDay: null, children: [{ ageBand: 'u3', weeklyHours: 45 }] }).fte).toBeCloseTo(0.263 * 45 / 35, 10)
  })
})

// --- group_pauschale (NW KiBiz Anlage zu § 33) ---
const nw = base({
  land: 'NW', method: 'group_pauschale',
  groupTypes: [{ key: 'gf1', label: 'Gruppenform I' }, { key: 'gf3', label: 'Gruppenform III' }],
  demand: [
    { groupType: 'gf3', weeklyHours: { upTo: 25 }, weeklyHoursPerGroup: { total: 71.0, minFachkraft: 27.5, leitung: 5 }, referenceChildren: 25 },
    { groupType: 'gf3', weeklyHours: { over: 25, upTo: 35 }, weeklyHoursPerGroup: { total: 99.0, minFachkraft: 38.5, leitung: 7 }, referenceChildren: 25 },
    { groupType: 'gf3', weeklyHours: { over: 35 }, weeklyHoursPerGroup: { total: 114.0, minFachkraft: 49.5, leitung: 9 }, referenceChildren: 20 },
  ],
  quotas: [{ key: 'fachkraft_min', label: 'Fachkraftstunden laut Pauschale', kind: 'demand_minimum', qualifications: ['fachkraft'] }],
})

describe('requiredFte – group_pauschale', () => {
  it('NW GF III at 35 h: a full group carries the table hours; Leitung shown only', () => {
    const r = requiredFte(nw, { groupType: 'gf3', openingMinutesPerDay: null, children: kids(25, { ageBand: 'ue3', weeklyHours: 35 }) })
    expect(r.fte).toBeCloseTo(99 / 39, 10)
    expect(r.fachkraftFte).toBeCloseTo(38.5 / 39, 10)
    const leitung = r.lines.find(l => l.key === 'leitung')!
    expect(leitung.counts).toBe(false)
    expect(leitung.fte).toBeCloseTo(7 / 39, 10)
  })

  it('mixes bookings per child and checks the Fachkraft minimum as a quota', () => {
    const children = [...kids(10, { ageBand: 'ue3', weeklyHours: 25 }), ...kids(10, { ageBand: 'ue3', weeklyHours: 45 })]
    const r = requiredFte(nw, { groupType: 'gf3', openingMinutesPerDay: null, children })
    expect(r.fte).toBeCloseTo((10 * 71 / 25 + 10 * 114 / 20) / 39, 10)
    const planned = plannedFte(nw, [{ qualification: 'fachkraft', share: null, hours: fullTime }], weeks)
    const [line] = quotaLines(nw, r, planned)
    expect(line!.limit).toBeCloseTo((10 * 27.5 / 25 + 10 * 49.5 / 20) / 39, 10)
    expect(line!.ok).toBe(true)
  })

  it('counts children of a group without group type as unmatched', () => {
    expect(requiredFte(nw, { groupType: null, openingMinutesPerDay: null, children: kids(4, { ageBand: 'ue3', weeklyHours: 35 }) }).unmatchedChildren).toBe(4)
  })
})

describe('facilityAddOns', () => {
  it('BW Leitung: 6 h for the first group plus 2 h for each further group', () => {
    const [line] = facilityAddOns(bw, { children: [], groupCount: 2, demandFte: 3.6 })
    expect(line).toMatchObject({ key: 'leitung', label: 'Leitungszeit', counts: false })
    expect(line!.fte * 39).toBeCloseTo(8, 10)
    expect(facilityAddOns(bw, { children: [], groupCount: 0, demandFte: 0 })[0]!.fte).toBe(0)
  })

  it('percent of demand, flat FTE, step tables and min/cap limits', () => {
    const rules = base({
      addOns: [
        { key: 'sn', label: 'Leitung SN', scope: 'facility', counts: false, mode: 'pct_of_demand', pct: 10 },
        { key: 'flat', label: 'Sockel', scope: 'facility', counts: false, mode: 'fte_flat', fte: 0.0625 },
        { key: 'steps', label: 'Stufen', scope: 'facility', counts: false, mode: 'step_table', basis: 'demand_fte', steps: [{ upTo: 4, fte: 0.125 }, { upTo: 10, fte: 0.25 }, { upTo: null, fte: 0.5 }] },
        { key: 'th', label: 'Leitung TH', scope: 'facility', counts: false, mode: 'fte_per_child', fte: 0.01, minFte: 0.2, capFte: 1.5 },
        { key: 'group', label: 'nur Gruppe', scope: 'group', counts: true, mode: 'fte_flat', fte: 1 },
      ],
    })
    const at = (children: number, demandFte: number) => facilityAddOns(rules, {
      children: kids(children, { ageBand: 'ue3', weeklyHours: 35 }), groupCount: 1, demandFte,
    })
    const lines = at(10, 6)
    expect(lines.map(l => l.key)).toEqual(['sn', 'flat', 'steps', 'th'])
    expect(lines[0]!.fte).toBeCloseTo(0.6, 10)
    expect(lines[1]!.fte).toBeCloseTo(0.0625, 10)
    expect(lines[2]!.fte).toBe(0.25)
    expect(lines[3]!.fte).toBeCloseTo(0.2, 10)
    expect(at(10, 4)[2]!.fte).toBe(0.125)
    expect(at(10, 40)[2]!.fte).toBe(0.5)
    expect(at(200, 6)[3]!.fte).toBeCloseTo(1.5, 10)
    expect(at(0, 6)[3]!.fte).toBe(0)
  })
})

describe('quotaLines', () => {
  it('max_share of the planned FTE (SN: at most 20 % Assistenz)', () => {
    const sn = base({ quotas: [{ key: 'assistenz', label: 'Assistenzkräfte höchstens 20 %', kind: 'max_share', qualifications: ['ergaenzung'], pct: 20, base: 'planned' }] })
    const required = requiredFte(sn, { groupType: null, openingMinutesPerDay: null, children: [] })
    const planned = plannedFte(sn, [
      { qualification: 'fachkraft', share: null, hours: 3 * fullTime },
      { qualification: 'ergaenzung', share: null, hours: fullTime },
    ], weeks)
    const [line] = quotaLines(sn, required, planned)
    expect(line!.limit).toBeCloseTo(0.8, 10)
    expect(line!.have).toBeCloseTo(1, 10)
    expect(line!.ok).toBe(false)
  })
})

describe('ruleSetProblems', () => {
  it('accepts complete rule sets', () => {
    for (const rules of [bw, by, be, nw]) expect(ruleSetProblems(rules)).toEqual([])
  })

  it('reports missing method values, bad shares and bad numbers', () => {
    const broken = base({
      method: 'group_fte', fteHoursPerWeek: 0,
      groupTypes: [{ key: 'rg', label: 'Regelgruppe' }],
      demand: [{ groupType: 'rg' }],
      staffShares: { ...shares, ergaenzung: 120 },
      addOns: [{ key: 'x', label: 'X', scope: 'group', counts: true, mode: 'pct_of_demand' }],
    })
    const problems = ruleSetProblems(broken)
    expect(problems).toHaveLength(4)
    expect(problems.join('\n')).toMatch(/fteHoursPerWeek/)
    expect(problems.join('\n')).toMatch(/demand\[0\]/)
    expect(problems.join('\n')).toMatch(/ergaenzung/)
    expect(problems.join('\n')).toMatch(/addOns\[0\]/)
  })

  const only = (over: Partial<StaffingRuleSet>) => ruleSetProblems(base({ demand: [{ ftePerGroup: 1.8 }], ...over }))

  it('keeps the full-time hours within 30–42', () => {
    expect(only({ fteHoursPerWeek: 29 })).toEqual([expect.stringMatching(/fteHoursPerWeek/)])
    expect(only({ fteHoursPerWeek: 43 })).toEqual([expect.stringMatching(/fteHoursPerWeek/)])
    expect(only({ fteHoursPerWeek: 30 })).toEqual([])
    expect(only({ fteHoursPerWeek: 42 })).toEqual([])
  })

  it('checks quota percentages, unique keys and min ≤ cap', () => {
    const quota = { label: 'Q', kind: 'min_share' as const, qualifications: ['fachkraft' as const], base: 'required' as const }
    expect(only({ quotas: [{ ...quota, key: 'q', pct: 120 }] })).toEqual([expect.stringMatching(/quotas\[0\].*pct/)])
    expect(only({ quotas: [{ ...quota, key: 'q', pct: 50 }, { ...quota, key: 'q', pct: 60 }] })).toEqual([expect.stringMatching(/quotas\[1\].*key/)])
    const addOn = { label: 'A', scope: 'group' as const, counts: false, mode: 'fte_flat' as const, fte: 0.1 }
    expect(only({ addOns: [{ ...addOn, key: 'a' }, { ...addOn, key: 'a' }] })).toEqual([expect.stringMatching(/addOns\[1\].*key/)])
    expect(only({ addOns: [{ ...addOn, key: 'demand' }] })).toEqual([expect.stringMatching(/addOns\[0\].*key/)])
    expect(only({ addOns: [{ ...addOn, key: 'a', minFte: 0.5, capFte: 0.2 }] })).toEqual([expect.stringMatching(/addOns\[0\].*minFte/)])
  })

  it('reserves the key "leitung" when the NW table rows carry Leitung hours', () => {
    const addOn = { key: 'leitung', label: 'L', scope: 'facility' as const, counts: false, mode: 'fte_flat' as const, fte: 0.1 }
    expect(ruleSetProblems({ ...nw, addOns: [addOn] })).toEqual([expect.stringMatching(/addOns\[0\].*key/)])
    expect(only({ addOns: [addOn] })).toEqual([])
  })

  it('requires group types of rows and presence rules to be declared', () => {
    expect(only({ demand: [{ groupType: 'vö', ftePerGroup: 1.9 }] })).toEqual([expect.stringMatching(/demand\[0\].*groupType/)])
    expect(only({
      groupTypes: [{ key: 'rg', label: 'RG' }], demand: [{ groupType: 'rg', ftePerGroup: 1.8 }],
      presence: [{ window: 'always', minStaff: 2, groupTypes: ['rg', 'krippe'] }],
    })).toEqual([expect.stringMatching(/presence\[0\].*krippe/)])
  })

  it('flags per-child conditions on group_fte rows (they would be ignored)', () => {
    expect(only({ demand: [{ ageBand: 'u3', ftePerGroup: 2 }] })).toEqual([expect.stringMatching(/demand\[0\].*ageBand/)])
    expect(only({ demand: [{ weeklyHours: { over: 25 }, ftePerGroup: 2 }] })).toEqual([expect.stringMatching(/demand\[0\].*weeklyHours/)])
    expect(only({ demand: [{ ageMonths: { below: 24 }, ftePerGroup: 2 }] })).toEqual([expect.stringMatching(/demand\[0\].*ageMonths/)])
  })

  it('checks presence rules: something required, sensible numbers', () => {
    expect(only({ presence: [{ window: 'haupt' }] })).toEqual([expect.stringMatching(/presence\[0\]/)])
    expect(only({ presence: [{ window: 'always', minStaff: -1 }] })).toEqual([expect.stringMatching(/presence\[0\].*minStaff/)])
    expect(only({ presence: [{ window: 'always', perChildren: { children: 0, staff: 1 } }] })).toEqual([expect.stringMatching(/presence\[0\].*perChildren/)])
    expect(only({ presence: [{ window: 'always', minFachkraft: 2, relaxFachkraft: { maxChildren: 15, minFachkraft: 3 } }] }))
      .toEqual([expect.stringMatching(/presence\[0\].*relaxFachkraft/)])
    expect(only({ presence: [{ window: 'haupt', minFachkraft: 2, relaxFachkraft: { maxChildren: 15, minFachkraft: 1 } }] })).toEqual([])
  })
})

// --- presence-only states (HB BremKTG § 10a) ---
const hb = base({
  land: 'HB', periodCheck: false, demand: [],
  presence: [{ window: 'always', perChildren: { children: 20, staff: 1, fachkraft: 1 } }],
})

describe('presence-only states', () => {
  it('have no period check: nothing required, nothing unmatched, no lines', () => {
    expect(hasPeriodCheck(hb)).toBe(false)
    expect(hasPeriodCheck(bw)).toBe(true)
    const r = requiredFte(hb, { groupType: null, openingMinutesPerDay: 480, children: kids(18, { ageBand: 'ue3', weeklyHours: 40 }) })
    expect(r).toEqual({ fte: 0, demandFte: 0, fachkraftFte: 0, lines: [], unmatchedChildren: 0, periodCheck: false })
    expect(requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 360, children: [] }).periodCheck).toBe(true)
    expect(facilityAddOns({ ...hb, addOns: [{ key: 'x', label: 'X', scope: 'facility', counts: false, mode: 'fte_flat', fte: 1 }] }, { children: [], groupCount: 1, demandFte: 0 })).toEqual([])
  })

  it('are valid with presence rules only; a set without demand needs periodCheck false and presence rules', () => {
    expect(ruleSetProblems(hb)).toEqual([])
    expect(ruleSetProblems({ ...hb, presence: [] })).toEqual([expect.stringMatching(/presence/)])
    expect(ruleSetProblems({ ...hb, periodCheck: true })).toEqual([expect.stringMatching(/demand/)])
  })
})

describe('tie-safe comparisons', () => {
  it('meets / atMost tolerate floating-point noise', () => {
    expect(meets(1.7999999999999998, 1.8)).toBe(true)
    expect(meets(1.79, 1.8)).toBe(false)
    expect(atMost(0.30000000000000004, 0.3)).toBe(true)
    expect(atMost(0.31, 0.3)).toBe(false)
  })

  it('quotaLines: an exact tie holds for min_share and max_share', () => {
    const tie = base({
      groupTypes: [{ key: 'rg', label: 'RG' }], demand: [{ groupType: 'rg', ftePerGroup: 1.8 }],
      quotas: [{ key: 'fk', label: 'FK', kind: 'min_share', qualifications: ['fachkraft'], pct: 100, base: 'required' }],
    })
    const required = requiredFte(tie, { groupType: 'rg', openingMinutesPerDay: null, children: kids(20, { ageBand: 'ue3', weeklyHours: 30 }) })
    const planned = plannedFte(tie, [
      { qualification: 'fachkraft', share: null, hours: fullTime },
      { qualification: 'fachkraft', share: null, hours: 31.2 * weeks },
    ], weeks)
    const [min] = quotaLines(tie, required, planned)
    expect(min!.have < min!.limit).toBe(true) // the raw comparison would fail
    expect(min!.ok).toBe(true)

    const capped = base({ quotas: [{ key: 'erg', label: 'Erg', kind: 'max_share', qualifications: ['ergaenzung'], pct: 30, base: 'planned' }] })
    const plannedErg = plannedFte(capped, [
      { qualification: 'fachkraft', share: null, hours: 0.7 * fullTime },
      { qualification: 'ergaenzung', share: null, hours: 0.1 * fullTime },
      { qualification: 'ergaenzung', share: null, hours: 0.2 * fullTime },
    ], weeks)
    const [max] = quotaLines(capped, requiredFte(capped, { groupType: null, openingMinutesPerDay: null, children: [] }), plannedErg)
    expect(max!.have > max!.limit).toBe(true)
    expect(max!.ok).toBe(true)
  })
})

describe('minor edge cases', () => {
  it('opening minutes 0 count as not entered (no scaling)', () => {
    expect(requiredFte(bw, { groupType: 'rg', openingMinutesPerDay: 0, children: kids(20, { ageBand: 'ue3', weeklyHours: 30 }) }).fte).toBeCloseTo(1.8, 10)
  })

  it('a step table yields 0 when its basis is 0', () => {
    const rules = base({ addOns: [{ key: 's', label: 'S', scope: 'facility', counts: false, mode: 'step_table', basis: 'children', steps: [{ upTo: 4, fte: 0.125 }] }] })
    expect(facilityAddOns(rules, { children: [], groupCount: 1, demandFte: 0 })[0]!.fte).toBe(0)
    expect(facilityAddOns(rules, { children: kids(1, { ageBand: 'ue3', weeklyHours: 30 }), groupCount: 1, demandFte: 0 })[0]!.fte).toBe(0.125)
  })
})
