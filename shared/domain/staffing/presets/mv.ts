import type { StaffingRuleSet } from '../types'
import { shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

const current: StaffingRuleSet = {
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
}

/** What the notes of the versions from 01.11.2026 on say about trainees, assistants and the quota. */
const TRAINEES = `${TRAINEES_NOTE} Auszubildende (Erzieher für 0- bis 10-Jährige): `
  + '0/0/50 % nach Ausbildungsjahr (§ 14 Abs. 7; das 1. Jahr zählt seit 01.08.2023, das 2. seit 01.08.2024 '
  + 'nicht mehr); andere Ausbildungen (Erzieher, Sozialassistenz, Kinderpflege) 0 % – beim Mitarbeiter '
  + 'eintragen. Pädagogische Assistenzkräfte 80 % (§ 14 Abs. 9). Studierende zählen nicht, auch nicht mit 120 '
  + 'Leistungspunkten (§ 13 Abs. 3). Assistenzkräfte, Auszubildende und Kräfte nach §§ 11/12 zusammen '
  + 'grundsätzlich höchstens 25 % des Bedarfs (§ 14 Abs. 6) – als Quote ohne die Kräfte nach §§ 11/12.'

/**
 * The corrected values of 01.11.2026 without the `correction` flag: it is set only in the list, so the later law version
 * built from this object cannot inherit it.
 */
const revised: StaffingRuleSet = {
  ...current,
  validFrom: TRAINEES_REVISED,
  source: 'KiföG M-V §§ 13, 14 (Kindergarten 1 : 14 ab 01.09.2024); Satzungen der Kreise; Landesrahmenvertrag § 24 '
    + 'Abs. 5',
  note: 'Bitte prüfen: Die Umrechnung in Vollzeitkräfte regeln die Kreise per Satzung; hier Krippe 1 : 6, '
    + 'Kindergarten 1 : 14, Hort 1 : 22 je 10 Std./Tag, anteilig nach Betreuungsstunden. Leitung (vermutlich '
    + `außerhalb der Relation) nicht enthalten. ${TRAINEES} Text des Gesetzes nur über eine Sekundärquelle gelesen. `
    + 'Geplant (noch kein Gesetz): Kindergarten 1 : 13 ab 2028, Hort 1 : 20 ab 2029.',
  staffShares: shares({ ergaenzung: 80, azubi_3: 50 }),
  quotas: [{
    key: 'assistenz', label: 'Assistenzkräfte und Auszubildende', kind: 'max_share',
    qualifications: ['ergaenzung', 'azubi_1', 'azubi_2', 'azubi_3'], pct: 25, base: 'required',
  }],
}

/** Mecklenburg-Vorpommern: durchschnittliche Fachkraft-Kind-Relation auf 10-Stunden-Basis (KiföG M-V § 14). */
export const MV: StaffingRuleSet[] = [
  current,
  { ...revised, correction: true },
  {
    // Krippe 1 : 5 from 01.01.2027 (Fünftes Gesetz zur Änderung des KiföG M-V); the rest as before
    ...revised,
    validFrom: '2027-01-01',
    source: 'KiföG M-V § 14 i. d. F. des Fünften Gesetzes zur Änderung des KiföG M-V (GVOBl. M-V 2026 S. 758; Krippe '
      + '1 : 5 ab 01.01.2027, Ausnahme mit Anzeige bis 31.07.2029); §§ 13, 14; Satzungen der Kreise; Landesrahmenvertrag '
      + '§ 24 Abs. 5',
    note: 'Bitte prüfen: Krippe 1 : 5 ab 01.01.2027 (bisher 1 : 6). Übergang: Bis längstens 31.07.2029 darf eine '
      + 'Einrichtung die alte Relation (1 : 6) weiter anwenden, wenn sie das dem Jugendamt anzeigt und den Elternrat '
      + 'informiert – dann trägt der Träger für die Krippe 6 Kinder je Vollzeitkraft ein. Hort 1 : 21 (ab 01.08.2027 oder 2028, Quellen uneinig) noch '
      + 'nicht übernommen. Die Umrechnung in Vollzeitkräfte regeln die Kreise per Satzung; hier Krippe 1 : 5, '
      + 'Kindergarten 1 : 14, Hort 1 : 22 je 10 Std./Tag, anteilig nach Betreuungsstunden. Leitung (vermutlich '
      + `außerhalb der Relation) nicht enthalten. ${TRAINEES} Gesetzestext nur über Sekundärquellen gelesen (Stand `
      + '19.11.2026).',
    demand: [
      { ageBand: 'u3', childrenPerFte: 5, refHoursPerWeek: 50 },
      { ageBand: 'ue3', childrenPerFte: 14, refHoursPerWeek: 50 },
      { ageBand: 'school', childrenPerFte: 22, refHoursPerWeek: 50 },
    ],
  },
]
