import type { StaffingRuleSet } from '../types'
import { shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

const current: StaffingRuleSet = {
  land: 'ST',
  validFrom: '2019-08-01',
  source: 'KiFöG LSA § 21 (Fassung ab 01.08.2019), § 22',
  confidence: 'medium',
  note: 'Bitte prüfen: Ob das Gesetz „Kita Stabil“ (eingebracht 17.12.2025) die Faktoren geändert hat, ist nicht '
    + 'bestätigt. Das Land rechnet mit Jahressummen für die ganze Einrichtung; hier je Monat und Gruppe. Zehn '
    + 'Ausfalltage je Vollzeitkraft sind im Schlüssel enthalten. Leitung („angemessen“) ohne Zahl. Es zählen nur '
    + 'Fachkräfte nach § 21 Abs. 3; Hilfskräfte nicht.',
  method: 'child_hours',
  fteHoursPerWeek: 39,
  demand: [
    { ageBand: 'u3', staffHoursPerChildHour: 0.187 },
    { ageBand: 'ue3', staffHoursPerChildHour: 0.083 },
    { ageBand: 'school', staffHoursPerChildHour: 0.052 },
  ],
  addOns: [],
  presence: [],
  staffShares: shares({ ergaenzung: 0 }),
  quotas: [],
}

/** Sachsen-Anhalt: Fachkraftstunden je gebuchte Betreuungsstunde (KiFöG LSA § 21). */
export const ST: StaffingRuleSet[] = [
  current,
  {
    ...current,
    validFrom: TRAINEES_REVISED,
    correction: true,
    source: 'KiFöG LSA § 21 (Fassung ab 01.08.2019), § 22; Richtlinie Landesmodellprogramm Fachkräfteoffensive '
      + '2024–2027 (MBl. LSA 2024 S. 584)',
    note: 'Bitte prüfen: Ob das Gesetz „Kita Stabil“ (eingebracht 17.12.2025) die Faktoren geändert hat, ist nicht '
      + 'bestätigt. Das Land rechnet mit Jahressummen für die ganze Einrichtung; hier je Monat und Gruppe. Zehn '
      + 'Ausfalltage je Vollzeitkraft sind im Schlüssel enthalten. Leitung („angemessen“) ohne Zahl. Es zählen '
      + 'Fachkräfte nach § 21 Abs. 3; Hilfskräfte nur, wenn das Jugendamt sie zulässt (§ 21 Abs. 4) – dann bei der '
      + `Person eintragen. ${TRAINEES_NOTE} Berufspraktikum (Anerkennungsjahr): als zugelassene Hilfskraft mit `
      + 'den bezahlten Stunden (100 %; Arbeitshilfe des Landesjugendamts); höchstens 1 Hilfskraft je 2 Fachkräfte – '
      + 'nicht geprüft. PiA: 0/30/70 % nach Ausbildungsjahr, mit Zulassung durch das Jugendamt (Nr. 5.1.7 der '
      + 'Richtlinie, MBl. LSA 2024 S. 584; bindend nur für geförderte Plätze). Berufsbegleitende Ausbildung 0 %, '
      + 'außer schon SPA/Kinderpfleger (dann als Hilfskraft eintragen). Studierende zählen nicht (nur Abschlüsse auf '
      + 'DQR-Niveau 6 sind Fachkräfte).',
    staffShares: shares({ ergaenzung: 0, azubi_2: 30, azubi_3: 70, praktikant: 100 }),
  },
]
