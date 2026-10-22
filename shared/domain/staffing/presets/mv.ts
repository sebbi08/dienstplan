import type { StaffingRuleSet } from '../types'
import { shares } from './common'

/** Mecklenburg-Vorpommern: durchschnittliche Fachkraft-Kind-Relation auf 10-Stunden-Basis (KiföG M-V § 14). */
export const MV: StaffingRuleSet[] = [{
  land: 'MV',
  validFrom: '2024-09-01',
  source: 'KiföG M-V § 14 (Kindergarten 1 : 14 ab 01.09.2024); Satzungen der Kreise; Landesrahmenvertrag § 24 Abs. 5',
  confidence: 'medium',
  note: 'Bitte prüfen: Die Umrechnung in Vollzeitkräfte regeln die Kreise per Satzung; hier Krippe 1 : 6, '
    + 'Kindergarten 1 : 14, Hort 1 : 22 je 10 Std./Tag, anteilig nach Betreuungsstunden. Leitung (vermutlich '
    + 'außerhalb der Relation) nicht enthalten. Erzieher-Auszubildende im 1./2. Jahr zählen nicht; Anrechnung '
    + 'anderer Auszubildender und von Ergänzungskräften nicht geprüft. Geplant (noch kein Gesetz): Kindergarten '
    + '1 : 13 ab 2028, Hort 1 : 20 ab 2029.',
  method: 'fte_per_child',
  fteHoursPerWeek: 39,
  demand: [
    { ageBand: 'u3', childrenPerFte: 6, refHoursPerWeek: 50 },
    { ageBand: 'ue3', childrenPerFte: 14, refHoursPerWeek: 50 },
    { ageBand: 'school', childrenPerFte: 22, refHoursPerWeek: 50 },
  ],
  addOns: [],
  presence: [],
  staffShares: shares(),
  quotas: [],
}]
