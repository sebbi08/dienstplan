import type { StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

const kindergarten = { ageBand: 'ue3', childrenPerFte: 10.5244, refHoursPerWeek: 45 } as const
const hort = { ageBand: 'school', childrenPerFte: 20.473, refHoursPerWeek: 30 } as const

const base: Omit<StaffingRuleSet, 'validFrom' | 'note' | 'demand'> = {
  land: 'SN',
  source: 'SächsKitaG § 12 (Fassung ab 01.08.2025, Art. 13 des Gesetzes vom 27.06.2025), § 23; SächsQualiVO',
  confidence: 'high',
  method: 'fte_per_child',
  fteHoursPerWeek: 40,
  addOns: [leitung({ mode: 'pct_of_demand', pct: 10 })],
  presence: [],
  // Erzieher-Praktikanten in der berufspraktischen Ausbildung: 0.5
  staffShares: shares({ praktikant: 50 }),
  quotas: [{
    key: 'assistenz', label: 'Assistenzkräfte', kind: 'max_share',
    qualifications: ['ergaenzung'], pct: 20, base: 'planned',
  }],
}

const NOTE = 'Finanzierungsschlüssel „in der Regel“, bezogen auf 9 Std./Tag (Hort 6 Std.), anteilig nach '
  + 'Betreuungsstunden; mittelbare Zeit ist enthalten. Anrechnung anderer Auszubildender nicht geprüft.'

/** Sachsen: Vollzeitkräfte (40 Std.) je Kinderzahl nach Alter (SächsKitaG § 12). */
export const SN: StaffingRuleSet[] = [
  {
    ...base,
    validFrom: '2025-08-01',
    note: `Krippe 1 : 4,6064 als Übergangswert bis 31.07.2026. ${NOTE}`,
    demand: [{ ageBand: 'u3', childrenPerFte: 4.6064, refHoursPerWeek: 45 }, { ...kindergarten }, { ...hort }],
  },
  {
    ...base,
    validFrom: '2026-08-01',
    note: NOTE,
    demand: [{ ageBand: 'u3', childrenPerFte: 4.5014, refHoursPerWeek: 45 }, { ...kindergarten }, { ...hort }],
  },
]
