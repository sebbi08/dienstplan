import { describe, expect, it } from 'vitest'
import { mergeShortfalls, presenceShortfalls } from '../../shared/domain/staffing/presence'
import type {
  AgeBand, Phase, PresenceRule, PresenceSlot, Qualification, StaffingRuleSet,
} from '../../shared/domain/staffing/types'

const shares = {
  fachkraft: 100, ergaenzung: 100, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, none: 0,
}
const rulesWith = (presence: PresenceRule[]): StaffingRuleSet => ({
  land: 'BW', validFrom: '2026-01-01', source: 'test', confidence: 'high', method: 'group_fte',
  fteHoursPerWeek: 39, demand: [{ ftePerGroup: 1.8 }], addOns: [], presence, staffShares: shares, quotas: [],
})
const children = (n: number, ageBand: AgeBand = 'ue3') => Array.from({ length: n }, () => ({ ageBand }))
const staff = (...qualifications: (Qualification | null)[]) => qualifications.map(qualification => ({ qualification }))
/** Slots every 15 minutes from `from` (inclusive) to `to` (exclusive), all with the same occupancy. */
const slots = (from: number, to: number, fill: Omit<PresenceSlot, 'minute'>): PresenceSlot[] => {
  const out: PresenceSlot[] = []
  for (let minute = from; minute < to; minute += 15) out.push({ minute, ...fill })
  return out
}

// BW KiTaVO § 1 Abs. 2 (all types except HT/RG): 2 Fachkräfte in the Hauptbetreuungszeit, 1 in the Randzeit
const bw = rulesWith([
  { window: 'haupt', minFachkraft: 2 },
  { window: 'rand', minFachkraft: 1 },
])
const bwPhase = (minute: number): Phase => (minute >= 420 && minute < 720 ? 'haupt' : 'rand')

describe('presenceShortfalls', () => {
  it('BW: one Fachkraft and a Zusatzkraft in the Hauptbetreuungszeit → one merged shortfall 7:00–8:00 (Review Focus 5)', () => {
    const day = [
      ...slots(390, 420, { children: children(8), staff: staff('fachkraft') }), // Randzeit: 1 FK is enough
      ...slots(420, 480, { children: children(20), staff: staff('fachkraft', 'ergaenzung') }),
      ...slots(480, 720, { children: children(20), staff: staff('fachkraft', 'fachkraft') }),
    ]
    expect(presenceShortfalls(bw, day, bwPhase)).toEqual([{ from: 420, to: 480, have: 1, need: 2, fachkraft: true }])
  })

  it('accepts slots in any order', () => {
    const day = slots(420, 480, { children: children(20), staff: staff('fachkraft') }).reverse()
    expect(presenceShortfalls(bw, day, bwPhase)).toEqual([{ from: 420, to: 480, have: 1, need: 2, fachkraft: true }])
  })

  it('splits when the count changes or slots are not consecutive', () => {
    const day = [
      ...slots(420, 450, { children: children(20), staff: staff('fachkraft') }),
      ...slots(450, 480, { children: children(20), staff: staff() }),
      ...slots(600, 630, { children: children(20), staff: staff() }),
    ]
    expect(presenceShortfalls(bw, day, bwPhase)).toEqual([
      { from: 420, to: 450, have: 1, need: 2, fachkraft: true },
      { from: 450, to: 480, have: 0, need: 2, fachkraft: true },
      { from: 600, to: 630, have: 0, need: 2, fachkraft: true },
    ])
  })

  it('needs nothing in a slot without children', () => {
    expect(presenceShortfalls(bw, slots(420, 480, { children: [], staff: staff() }), bwPhase)).toEqual([])
  })

  it('phase "always": only the rules for the whole day apply', () => {
    const rules = rulesWith([{ window: 'haupt', minFachkraft: 2 }, { window: 'always', minFachkraft: 1 }])
    const day = slots(420, 450, { children: children(5), staff: staff() })
    expect(presenceShortfalls(rules, day, () => 'always')).toEqual([{ from: 420, to: 450, have: 0, need: 1, fachkraft: true }])
    expect(presenceShortfalls(rules, day, () => 'haupt')).toEqual([{ from: 420, to: 450, have: 0, need: 2, fachkraft: true }])
  })

  it('SH: 1 Kraft per started 15 children (U3 double), at least 2, one Fachkraft', () => {
    const sh = rulesWith([{
      window: 'always', minStaff: 2, minFachkraft: 1,
      perChildren: { children: 15, staff: 1 }, childWeights: { u3: 2 },
    }])
    const at = (kids: { ageBand: AgeBand }[], present: (Qualification | null)[]) =>
      presenceShortfalls(sh, [{ minute: 480, children: kids, staff: staff(...present) }], () => 'always')
    // 10 Ü3 + 5 U3 = 20 weighted → 2 Kräfte
    expect(at([...children(10), ...children(5, 'u3')], ['fachkraft'])).toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: false }])
    expect(at([...children(10), ...children(5, 'u3')], ['fachkraft', 'ergaenzung'])).toEqual([])
    // 16 Ü3 + 8 U3 = 32 weighted → 3 Kräfte
    expect(at([...children(16), ...children(8, 'u3')], ['fachkraft', 'ergaenzung'])).toEqual([{ from: 480, to: 495, have: 2, need: 3, fachkraft: false }])
    // two Ergänzungskräfte: enough staff but no Fachkraft
    expect(at(children(10), ['ergaenzung', 'ergaenzung'])).toEqual([{ from: 480, to: 495, have: 0, need: 1, fachkraft: true }])
  })

  it('reports only the Fachkraft gap when a further Fachkraft would close both gaps', () => {
    const rules = rulesWith([{ window: 'always', minStaff: 2, minFachkraft: 2 }])
    expect(presenceShortfalls(rules, [{ minute: 480, children: children(10), staff: staff('fachkraft') }], () => 'always'))
      .toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: true }])
  })

  it('perChildren with Fachkräfte per block (HB: 1 Fachkraft + 1 Kraft per 10 U3)', () => {
    const hb = rulesWith([{ window: 'always', perChildren: { children: 10, staff: 2, fachkraft: 1 } }])
    expect(presenceShortfalls(hb, [{ minute: 480, children: children(12, 'u3'), staff: staff('fachkraft', 'ergaenzung', 'ergaenzung') }], () => 'always'))
      .toEqual([
        { from: 480, to: 495, have: 1, need: 2, fachkraft: true },
      ])
  })

  it('relaxFachkraft: with few children the second may be a Zusatzkraft (BW one-group facility)', () => {
    const rules = rulesWith([{ window: 'always', minStaff: 2, minFachkraft: 2, relaxFachkraft: { maxChildren: 15, minFachkraft: 1 } }])
    const at = (n: number) => presenceShortfalls(rules, [{ minute: 480, children: children(n), staff: staff('fachkraft', 'ergaenzung') }], () => 'always')
    expect(at(15)).toEqual([])
    expect(at(16)).toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: true }])
  })

  it('rules limited by group type or by a minimum of children', () => {
    const rules = rulesWith([
      { window: 'always', groupTypes: ['krippe'], minStaff: 3 },
      { window: 'always', minChildren: 11, minStaff: 2 },
    ])
    const slot = (n: number) => [{ minute: 480, children: children(n, 'u3'), staff: staff('fachkraft') }]
    expect(presenceShortfalls(rules, slot(10), () => 'always')).toEqual([])
    expect(presenceShortfalls(rules, slot(11), () => 'always')).toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: false }])
    expect(presenceShortfalls(rules, slot(5), () => 'always', 'krippe')).toEqual([{ from: 480, to: 495, have: 1, need: 3, fachkraft: false }])
  })

  it('staff count only with a share above 0; without qualification they count as Kraft, not as Fachkraft', () => {
    const rules = rulesWith([{ window: 'always', minStaff: 2 }])
    const at = (present: PresenceSlot['staff']) => presenceShortfalls(rules, [{ minute: 480, children: children(5), staff: present }], () => 'always')
    expect(at(staff('fachkraft', 'azubi_1'))).toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: false }])
    expect(at(staff('fachkraft', 'none'))).toEqual([{ from: 480, to: 495, have: 1, need: 2, fachkraft: false }])
    expect(at([{ qualification: 'fachkraft' }, { qualification: 'azubi_1', share: 50 }])).toEqual([])
    expect(at(staff('fachkraft', null))).toEqual([])
    expect(presenceShortfalls(rulesWith([{ window: 'always', minFachkraft: 1 }]), [{ minute: 480, children: children(5), staff: staff(null) }], () => 'always'))
      .toEqual([{ from: 480, to: 495, have: 0, need: 1, fachkraft: true }])
  })

  it('returns nothing for a state without presence rules', () => {
    expect(presenceShortfalls(rulesWith([]), slots(420, 480, { children: children(20), staff: staff() }), () => 'always')).toEqual([])
  })
})

describe('mergeShortfalls', () => {
  it('sorts its input before merging', () => {
    const gap = (from: number, fachkraft = true) => ({ from, to: from + 15, have: 1, need: 2, fachkraft })
    expect(mergeShortfalls([gap(450), gap(420), gap(435, false), gap(435), gap(420, false)])).toEqual([
      { from: 420, to: 465, have: 1, need: 2, fachkraft: true },
      { from: 420, to: 450, have: 1, need: 2, fachkraft: false },
    ])
  })
})
