import type { AgeBand, DemandRule, StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/** Betreuungsmittelwert per booked weekly hours band (HKJGB § 25c). */
const MITTELWERT = [
  { weeklyHours: { upTo: 25 }, countedWeeklyHours: 22.5 },
  { weeklyHours: { over: 25, upTo: 35 }, countedWeeklyHours: 30 },
  { weeklyHours: { over: 35, below: 45 }, countedWeeklyHours: 42.5 },
  { weeklyHours: { atLeast: 45 }, countedWeeklyHours: 50 },
] as const

const FACTOR: Record<AgeBand, number> = { u3: 0.2, ue3: 0.07, school: 0.06 }

const demand: DemandRule[] = (Object.keys(FACTOR) as AgeBand[]).flatMap(ageBand =>
  MITTELWERT.map(band => ({ ageBand, ...band, weeklyHours: { ...band.weeklyHours }, staffHoursPerChildHour: FACTOR[ageBand] })),
)

/** Hessen: Fachkraftfaktor × Betreuungsmittelwert je Kind, plus Ausfall und Leitung (HKJGB § 25c). */
export const HE: StaffingRuleSet[] = [{
  land: 'HE',
  validFrom: '2025-12-10',
  source: 'HKJGB §§ 25b–25d (zuletzt geändert durch Gesetz vom 10.12.2025, GVBl. Nr. 93)',
  confidence: 'high',
  note: 'Nicht abgebildet: Kräfte der Nr. 7–9 des § 25b (Gesundheitsberufe, Fachfremde) höchstens 30 % des Bedarfs '
    + 'ohne Leitung; Kräfte, die 42 Tage oder länger fehlen, zählen nicht; Gruppengröße nach § 25d. Praktikant/in = '
    + 'Anerkennungsjahr (bis 50 %); Anrechnung anderer Auszubildender nicht geprüft.',
  method: 'child_hours',
  fteHoursPerWeek: 39,
  demand,
  addOns: [
    { key: 'ausfall', label: 'Ausfallzeiten (22 %)', scope: 'group', counts: true, mode: 'pct_of_demand', pct: 22 },
    leitung({ mode: 'pct_of_demand', pct: 20, capFte: 1.5 }),
  ],
  presence: [{ window: 'always', minFachkraft: 1 }],
  staffShares: shares({ praktikant: 50 }),
  quotas: [],
}]
