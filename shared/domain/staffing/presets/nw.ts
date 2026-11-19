import type { DemandRule, StaffingRuleSet } from '../types'
import { shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

/** Weekly booking bands of the Anlage zu § 33 KiBiz: 25 / 35 / 45 hours. */
const BOOKING = [{ upTo: 25 }, { over: 25, upTo: 35 }, { over: 35 }] as const

/** [Leitung, Gesamtpersonalkraftstunden, davon mind. Fachkraftstunden] per group and week, for 25 / 35 / 45 h. */
type Table = readonly (readonly [leitung: number, total: number, minFachkraft: number])[]

function rows(groupType: string, table: Table, referenceChildren: readonly number[]): DemandRule[] {
  return table.map(([leitung, total, minFachkraft], i) => ({
    groupType,
    weeklyHours: { ...BOOKING[i] },
    weeklyHoursPerGroup: { total, minFachkraft, leitung },
    referenceChildren: referenceChildren[i]!,
  }))
}

const BASE_NOTE = 'Leitungsstunden laut Pauschale werden nur angezeigt. Gruppenform III: Ergänzungskraftstunden in '
  + 'Höhe der Fachkraftstunden sind Pflicht – nicht geprüft. Regelmäßig 2 Kräfte je Gruppe während der '
  + 'Betreuungszeit, mind. 10 % Verfügungszeit, höchstens 2 Kinder über der Gruppengröße – nicht als Warnung '
  + 'geprüft. Das Land rechnet im Kindergartenjahr.'

const NOTE = `${BASE_NOTE} Anrechnung von Auszubildenden (PiA) nicht geprüft.`

const TRAINEES = `${TRAINEES_NOTE} Nach § 13 der Personalverordnung (PersVO vom 27.11.2024, GV. NRW. S. 910): `
  + 'Auszubildende (PiA Erzieher/Heilerziehungspflege) zählen mit ihrer Zeit in der Kita (100 %), aber nicht als '
  + 'Fachkraft – im 1. Jahr auf Ergänzungskraftstunden, im 2./3. Jahr mit der Hälfte bzw. zwei Dritteln auf '
  + 'Fachkraftstunden (nicht abgebildet). PiA Kinderpflege: 1. Jahr 0 %, 2. Jahr 50 % – beim Mitarbeiter '
  + 'eintragen. Berufspraktikum 100 % (Ergänzungskraftstunden). Studierende der Studiengänge nach § 4 Abs. 2 '
  + 'PersVO (Soziale Arbeit, Sozial- und Kindheitspädagogik, Erziehungswissenschaft, Heil-/Sonderpädagogik) ab 60 '
  + 'Leistungspunkten und 200 Std. Praxis als Ergänzungskraft, ab 90 Leistungspunkten und 400 Std. als Fachkraft '
  + '(§ 13 Abs. 4), höchstens 2 Jahre – hier 2. Studienjahr als Ergänzungskraft, ab dem 3. als Fachkraft; die '
  + 'Leistungspunkte prüft der Träger. Gilt auch für Werkstudenten dieser Studiengänge (dann Studium wählen).'

const current: StaffingRuleSet = {
  land: 'NW',
  validFrom: '2020-08-01',
  source: 'KiBiz §§ 28, 29, 33 und Anlage zu § 33 Abs. 1 (GV. NRW. 2020 S. 77; gültig bis Kita-Jahr 2026/27)',
  confidence: 'high',
  note: NOTE,
  method: 'group_pauschale',
  fteHoursPerWeek: 39,
  groupTypes: [
    { key: 'gf1', label: 'Gruppenform I (2 Jahre bis Schule)' },
    { key: 'gf2', label: 'Gruppenform II (unter 3 Jahre)' },
    { key: 'gf3', label: 'Gruppenform III (3 Jahre bis Schule)' },
  ],
  demand: [
    ...rows('gf1', [[5, 71.5, 55.0], [7, 99.5, 77.0], [9, 128.0, 99.0]], [20, 20, 20]),
    ...rows('gf2', [[5, 76.5, 55.0], [7, 107.0, 77.0], [9, 137.5, 99.0]], [10, 10, 10]),
    ...rows('gf3', [[5, 71.0, 27.5], [7, 99.0, 38.5], [9, 114.0, 49.5]], [25, 25, 20]),
  ],
  // Leitung comes from the table rows (line "leitung"); no separate add-on
  addOns: [],
  presence: [],
  staffShares: shares(),
  quotas: [{
    key: 'fachkraftstunden', label: 'Fachkraftstunden laut Pauschale', kind: 'demand_minimum',
    qualifications: ['fachkraft'],
  }],
}

const revised: StaffingRuleSet = {
  ...current,
  validFrom: TRAINEES_REVISED,
  correction: true,
  source: 'KiBiz §§ 28, 29, 33 und Anlage zu § 33 Abs. 1 (GV. NRW. 2020 S. 77; gültig bis Kita-Jahr 2026/27); '
    + 'Personalverordnung § 13 (GV. NRW. 2024 S. 910)',
  note: `${TRAINEES} ${BASE_NOTE}`,
  staffShares: shares({ azubi_1: 100, azubi_2: 100, azubi_3: 100, studium_2: 100, studium_3: 100, praktikant: 100 }),
  fachkraftQualifications: ['fachkraft', 'studium_3'],
  quotas: [{
    key: 'fachkraftstunden', label: 'Fachkraftstunden laut Pauschale', kind: 'demand_minimum',
    qualifications: ['fachkraft', 'studium_3'],
  }],
}

/** Nordrhein-Westfalen: Kindpauschalen je Gruppenform und Betreuungszeit (KiBiz Anlage zu § 33). */
export const NW: StaffingRuleSet[] = [
  current,
  revised,
  {
    ...revised,
    validFrom: '2027-08-01',
    correction: false,
    confidence: 'low',
    source: 'KiBiz in der Fassung des Gesetzes vom 21.07.2026 (Anlagen 1/2, ab 01.08.2027); Personalverordnung § 13 '
      + '(GV. NRW. 2024 S. 910)',
    note: 'Bitte prüfen: Ab 01.08.2027 gilt das neue KiBiz (5 Buchungsstufen 25/30/35/40/45 Std., Leitungszeit '
      + `5–9 Std. je Gruppe); die neuen Werte sind noch nicht übernommen, hier die bisherigen. ${TRAINEES} ${BASE_NOTE}`,
  },
]
