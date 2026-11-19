import type { AgeBand, DemandRule, StaffingRuleSet } from '../types'
import { leitung, shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

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

const current: StaffingRuleSet = {
  land: 'HE',
  validFrom: '2025-12-10',
  source: 'HKJGB §§ 25b–25d (zuletzt geändert durch Gesetz vom 10.12.2025, GVBl. Nr. 93)',
  confidence: 'high',
  note: 'Nicht abgebildet: Kräfte der Nr. 7–9 des § 25b (Gesundheitsberufe, Fachfremde) höchstens 30 % des Bedarfs '
    + 'ohne Leitung; Kräfte, die 42 Tage oder länger fehlen, zählen nicht; Gruppengröße nach § 25d. Praktikant/in = '
    + 'Anerkennungsjahr (bis 50 %); Anrechnung anderer Auszubildender nicht geprüft. Mindestbesetzung hier je '
    + 'Gruppe geprüft; das Gesetz meint ggf. die ganze Einrichtung – bitte prüfen. Beginn dieser Fassung nicht '
    + 'recherchiert (Datum des Änderungsgesetzes).',
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
}

/** Hessen: Fachkraftfaktor × Betreuungsmittelwert je Kind, plus Ausfall und Leitung (HKJGB § 25c). */
export const HE: StaffingRuleSet[] = [
  current,
  {
    ...current,
    validFrom: TRAINEES_REVISED,
    source: 'HKJGB §§ 25b–25d (zuletzt geändert durch Gesetz vom 10.12.2025, GVBl. Nr. 93); FAQ des '
      + 'Sozialministeriums zur HKJGB-Novelle (Stand 25.03.2026)',
    note: `${TRAINEES_NOTE} PivA, berufsbegleitende Ausbildung und berufsbegleitendes/duales Studium zählen als `
      + 'Fachkräfte zur Mitarbeit mit 100 % der vereinbarten Zeit in der Kita (§ 25b Abs. 3 Nr. 1, Ministeriums-FAQ; '
      + 'duales Studium nicht ausdrücklich genannt); Schulzeit zählt nicht. Plätze aus dem Landesprogramm '
      + 'Fachkräfteoffensive: 0/30/70 % nach Ausbildungsjahr – beim Mitarbeiter eintragen. Berufspraktikant/in = '
      + 'Anerkennungsjahr, auch nach einem Studium: bis 50 % (§ 25c Abs. 4; 100 %, wenn schon Kinderpfleger/in oder '
      + 'Sozialassistent/in – beim Mitarbeiter eintragen). Vollzeitschüler, Praxissemester und Werkstudenten zählen '
      + 'nicht. Nicht abgebildet: Kräfte der Nr. 7–9 des § 25b (Gesundheitsberufe, Fachfremde) höchstens 30 % des '
      + 'Bedarfs ohne Leitung; Kräfte, die 42 Tage oder länger fehlen, zählen nicht; Gruppengröße nach § 25d. '
      + 'Mindestbesetzung hier je Gruppe geprüft; das Gesetz meint ggf. die ganze Einrichtung – bitte prüfen. Beginn '
      + 'der Fassung vom 10.12.2025 nicht recherchiert.',
    staffShares: shares({
      praktikant: 50, azubi_1: 100, azubi_2: 100, azubi_3: 100, studium_1: 100, studium_2: 100, studium_3: 100,
    }),
  },
]
