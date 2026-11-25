import type { StaffingRuleSet } from '../types'
import { shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

const current: StaffingRuleSet = {
  land: 'SH',
  validFrom: '2025-01-01',
  source: 'KiTaG Schleswig-Holstein §§ 25–29 (in Kraft seit 01.01.2025); Wortlaut aus der Formulierungshilfe '
    + '(Landtag Unterrichtung 20/193)',
  confidence: 'medium',
  note: 'Bitte prüfen: Das Gesetz rechnet mit Sollbelegungsstunden (volle Gruppenkapazität × Öffnungszeit); hier '
    + 'ersatzweise mit den gebuchten Stunden der Vertragskinder. Nicht abgebildet: Anhebung des Teilers je '
    + 'Schließtag (+0,025 / 0,03 / 0,035); Quereinsteiger höchstens 1/8; die zweite Kraft muss mind. pädagogische '
    + 'Assistenzkraft sein (außer bei weniger als 10 Kindern); Leitungsfreistellung (§ 29). Endgültiger '
    + 'Gesetzeswortlaut nicht geprüft. Anrechnung von Auszubildenden nicht geprüft.',
  method: 'child_hours',
  fteHoursPerWeek: 39,
  demand: [
    { ageBand: 'u3', childHoursPerStaffHour: 4 },
    { ageBand: 'ue3', childHoursPerStaffHour: 9 },
    { ageBand: 'school', childHoursPerStaffHour: 10 },
  ],
  addOns: [],
  // at all times: 1 Kraft per started 15 children (U3 count double), at least 2, one with Gruppenleitung qualification
  presence: [{ window: 'always', minStaff: 2, minFachkraft: 1, perChildren: { children: 15, staff: 1 }, childWeights: { u3: 2 } }],
  staffShares: shares(),
  quotas: [{
    key: 'fachkraftquote', label: 'Fachkräfte', kind: 'min_share',
    qualifications: ['fachkraft'], pct: 50, base: 'required',
  }],
}

/** Schleswig-Holstein: Anstellungsschlüssel (KiTaG § 26) und Mindestanwesenheit (§ 27). */
export const SH: StaffingRuleSet[] = [
  current,
  {
    ...current,
    validFrom: TRAINEES_REVISED,
    correction: true,
    source: 'KiTaG Schleswig-Holstein §§ 25–29 (in Kraft seit 01.01.2025); Wortlaut aus der Formulierungshilfe '
      + '(Landtag Unterrichtung 20/193); PQVO vom 11.03.2025 (GVOBl. 2025 Nr. 42) § 4',
    note: 'Bitte prüfen: Das Gesetz rechnet mit Sollbelegungsstunden (volle Gruppenkapazität × Öffnungszeit); hier '
      + 'ersatzweise mit den gebuchten Stunden der Vertragskinder. Nicht abgebildet: Anhebung des Teilers je '
      + 'Schließtag (+0,025 / 0,03 / 0,035); Quereinsteiger höchstens 1/8; die zweite Kraft muss mind. pädagogische '
      + 'Assistenzkraft sein (außer bei weniger als 10 Kindern); Leitungsfreistellung (§ 29). Endgültiger '
      + `Gesetzeswortlaut nicht geprüft. ${TRAINEES_NOTE} Auszubildende (Erzieher, Heilerziehungspflege) zählen im `
      + '3. Jahr als pädagogische Assistenzkraft mit allen Stunden der Praxiszeit (§ 4 Nr. 1 PQVO); im 2. Jahr nur in '
      + 'berufsbegleitender oder PiA-Form mit deutlich mehr Praxisstunden im 1. Jahr – dann bei der Person '
      + 'eintragen; PiA Sozialpädagogische Assistenz 0 %. Duales Studium (Kindheitspädagogik, Soziale Arbeit) ab dem '
      + '3. Semester, wenn die Module der ersten beiden Semester bestanden sind, als Assistenzkraft (§ 4 Nr. 2 PQVO), '
      + 'nicht für die Fachkraftquote. Praktikanten, Praxissemester und Werkstudenten sind Hilfskräfte und zählen '
      + 'nicht (§ 28 Abs. 7 KiTaG).',
    staffShares: shares({ azubi_3: 100, studium_2: 100, studium_3: 100 }),
  },
]
