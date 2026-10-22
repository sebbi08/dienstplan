import type { DemandRule, HoursBand, StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/** Children per 38.5-h position by Betreuungsumfang: Ganztag / Teilzeit / Halbtag. */
type Ratios = readonly [ganztag: number, teilzeit: number, halbtag: number]

/** Betreuungsumfang per week (5 days): Halbtag up to 5 h/day, Teilzeit 5–7 h, Ganztag over 7 h (erweitert included). */
const BANDS: readonly HoursBand[] = [{ over: 35 }, { over: 25, upTo: 35 }, { upTo: 25 }]

function rows(under2: Ratios, twoToThree: Ratios, ue3: Ratios): DemandRule[] {
  const band = (ratios: Ratios, rule: Omit<DemandRule, 'weeklyHours' | 'childrenPerFte'>) =>
    ratios.map((childrenPerFte, i) => ({ ...rule, weeklyHours: BANDS[i], childrenPerFte }))
  return [
    // under 2 first: a child without age in months falls through to the 2–3 rows
    ...band(under2, { ageBand: 'u3', ageMonths: { below: 24 } }),
    ...band(twoToThree, { ageBand: 'u3' }),
    ...band(ue3, { ageBand: 'ue3' }),
  ]
}

const UE3: Ratios = [9, 11, 14]

const base: Omit<StaffingRuleSet, 'validFrom' | 'note' | 'demand'> = {
  land: 'BE',
  source: 'KitaFöG Berlin § 11 Abs. 2 (Gesetz vom 11.12.2025, GVBl. S. 629); VOKitaFöG §§ 15–19',
  confidence: 'high',
  method: 'fte_per_child',
  fteHoursPerWeek: 38.5,
  addOns: [
    {
      key: 'erweitert', label: 'Zuschlag erweiterte Betreuung (über 9 Std.)', scope: 'group', counts: true,
      mode: 'fte_per_child', fte: 0.015, weeklyHours: { over: 45 },
    },
    leitung({ mode: 'fte_per_child', fte: 0.0118 }),
  ],
  presence: [],
  staffShares: shares({ ergaenzung: 0 }),
  quotas: [],
}

const NOTE = 'Zuschläge für Kinder mit Behinderung (Typ A 0,25 / Typ B 0,5), ndH-Kinder (0,017 bei über 40 %), '
  + 'QM/MSS-Gebiet (0,010) und Sprachförderung sind nicht abgebildet. Schulkinder (Hort) ohne Werte. Zählt nur '
  + 'pädagogisches Fachpersonal; Anrechnung von Quereinsteigern/Auszubildenden nicht geprüft (Jugend-Rundschreiben).'

/** Berlin: 38,5 Wochenstunden Fachpersonal je X Kinder nach Alter und Betreuungsumfang. */
export const BE: StaffingRuleSet[] = [
  {
    ...base,
    validFrom: '2025-01-01',
    note: `Werte bis 31.12.2025 (Beginn dieser Fassung nicht recherchiert). ${NOTE}`,
    demand: rows([3.75, 5, 7], [4.75, 6, 8], UE3),
  },
  {
    ...base,
    validFrom: '2026-01-01',
    note: `Übergangswerte 01.01.–31.07.2026. ${NOTE}`,
    demand: rows([3.25, 4.5, 6.5], [4.25, 5.5, 7.5], UE3),
  },
  {
    ...base,
    validFrom: '2026-08-01',
    note: `${NOTE} Ab 2027 ersetzt das berlinpass-Kriterium das ndH-Kriterium.`,
    demand: rows([2.75, 4, 6], [3.75, 5, 7], UE3),
  },
]
