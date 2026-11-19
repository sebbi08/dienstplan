import { addDays } from './dates'
import type { IsoDate } from './types'

// Notifiable diseases of children (§ 34 IfSG): the catalogue of the RKI „Empfehlungen für die Wiederzulassung zu
// Gemeinschaftseinrichtungen gemäß § 34 IfSG“ (Stand 23.10.2026), summarised in short own words. Table 1 of the source
// (page 4) decides which kinds apply to a disease; pages 7–43 give the readmission per kind. The server reads the rules
// of a facility only through `ifsgRulesFor` (server/services/ifsg.ts), which returns this catalogue today.

/** Erkrankt oder Verdacht (§ 34 Abs. 1), Ausscheider (Abs. 2), Erkrankung in der Wohngemeinschaft (Abs. 3). */
export type IfsgKind = 'sick' | 'carrier' | 'household'
export const IFSG_KINDS: readonly IfsgKind[] = ['sick', 'carrier', 'household']

/**
 * What the readmission needs: nothing, a declaration of the parents, a medical judgement (written as an attest when the
 * facility asks for one), or the consent of the health office.
 */
export type IfsgProof = 'none' | 'parent_declaration' | 'medical_certificate' | 'health_office'
export const IFSG_PROOFS: readonly IfsgProof[] = ['none', 'parent_declaration', 'medical_certificate', 'health_office']

/**
 * The day a date rule counts from: the onset of the illness (the case's onset date) or a date of its own (rash onset,
 * antibiotic start, end of the symptoms, jaundice, gland swelling, treatment, last contact, start of the
 * chemoprophylaxis).
 */
export type IfsgAnchor =
  | 'onset' | 'rash' | 'antibiotic' | 'symptom_end' | 'jaundice' | 'gland_swelling' | 'treatment' | 'last_contact' | 'prophylaxis'
export const IFSG_ANCHORS: readonly IfsgAnchor[] = [
  'onset', 'rash', 'antibiotic', 'symptom_end', 'jaundice', 'gland_swelling', 'treatment', 'last_contact', 'prophylaxis',
]

/**
 * A simple date rule: readmission at the earliest `days` after the anchor day. `label` tells the variants of a kind
 * apart („mit Antibiotikum“; empty for a single rule); `condition` is what must hold besides the day („und
 * symptomfrei“; empty when nothing).
 */
export interface IfsgDateRule {
  key: string
  anchor: IfsgAnchor
  days: number
  label: string
  condition: string
}

/** The readmission of one kind: a short text, the proof it needs and the date rules (none: no day can be computed). */
export interface IfsgKindRule {
  text: string
  proof: IfsgProof
  rules: readonly IfsgDateRule[]
  /** Where the readmission comes from: the RKI (left out) or the local health office (shared/domain/ifsgLocal.ts). */
  source?: 'rki' | 'local'
}

/**
 * A disease of the rules. `notify`: the Leitung must notify the health office (§ 34 Abs. 6; every disease of § 34).
 * `binding`: § 34 forbids the visit (every RKI disease); false for a local disease that is only a recommendation (no
 * block at „Kommt“, no reminder). `hint`: a very short note for the parents' notice (what to watch for, what to do).
 * `source`: 'local' when the health office changed something or added the disease.
 */
export interface IfsgDisease {
  key: string
  name: string
  notify: boolean
  binding: boolean
  kinds: Partial<Record<IfsgKind, IfsgKindRule>>
  hint: string
  source: 'rki' | 'local'
}

const rule = (key: string, anchor: IfsgAnchor, days: number, label = '', condition = ''): IfsgDateRule =>
  ({ key, anchor, days, label, condition })

const MEDICAL = 'medical_certificate' as const
const OFFICE = 'health_office' as const

/** Abs. 2: Ausscheider are readmitted only with the consent of the health office and under its protective measures. */
const carrier = (text: string): IfsgKindRule => ({
  text: `Nur mit Zustimmung des Gesundheitsamtes und unter Beachtung der angeordneten Schutzmaßnahmen. ${text}`,
  proof: OFFICE, rules: [],
})

const HYGIENE_HINT = 'Auf Durchfall, Erbrechen und Fieber achten; gründlich Hände mit Seife waschen. Bei Beschwerden die Kinderarztpraxis anrufen.'

/** The 24 diseases of table 1, in the order of the source's table of contents (see IFSG_CATALOGUE). */
const RKI_DISEASES: readonly Omit<IfsgDisease, 'binding' | 'source'>[] = [
  {
    key: 'cholera', name: 'Cholera', notify: true,
    kinds: {
      sick: { text: 'Nach klinischer Genesung und 3 negativen Stuhlproben im Abstand von 1–2 Tagen (nach Antibiotika die erste frühestens 24 Stunden nach deren Ende) – nur nach ärztlicher Feststellung und Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      carrier: carrier('Nach 3 negativen Stuhlproben im Abstand von 1–2 Tagen ist wieder zuzulassen.'),
      household: { text: 'Nach einer negativen Stuhlprobe, frühestens 5 Tage nach der letzten möglichen Ansteckung entnommen – Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: `5 Tage lang auf Durchfall und Erbrechen achten und bei Verdacht früh ärztlich abklären lassen. ${HYGIENE_HINT}`,
  },
  {
    key: 'diphtherie', name: 'Diphtherie', notify: true,
    kinds: {
      sick: { text: 'Erst nach negativen Abstrichen (je nach Befund vor bzw. frühestens 24 Stunden nach Ende der Antibiotikatherapie) – nur nach ärztlicher Feststellung und Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      carrier: carrier('Nach 2 negativen Abstrichpaaren (frühestens 24 Stunden nach Therapieende, mindestens 24 Stunden Abstand) ist wieder zuzulassen.'),
      household: { text: 'Nach negativem Abstrich (vor oder frühestens 24 Stunden nach Ende der vorbeugenden Antibiotikagabe) – Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: '10 Tage lang auf Halsschmerzen, Fieber und Schluckbeschwerden achten; den Impfpass prüfen und fehlende Impfungen nachholen lassen.',
  },
  {
    key: 'ehec', name: 'EHEC-Enteritis / HUS', notify: true,
    kinds: {
      sick: { text: 'Je nach Erregerstamm nach klinischer Genesung und negativen Stuhlproben bzw. frühestens 48 Stunden nach Abklingen der Symptome – nur nach ärztlicher Feststellung und Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      carrier: carrier('Bei HUS-assoziierten Stämmen nach 2 negativen Stuhlproben (mindestens 24 Stunden Abstand).'),
      household: { text: 'Je nach Erregerstamm nach einer negativen Stuhlprobe bzw. solange keine Magen-Darm-Beschwerden auftreten – Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: HYGIENE_HINT,
  },
  {
    key: 'gastroenteritis', name: 'Infektiöse Gastroenteritis (Kinder unter 6 Jahren)', notify: true,
    kinds: {
      sick: {
        text: 'Frühestens 48 Stunden nach dem Abklingen von Durchfall und Erbrechen.', proof: MEDICAL,
        rules: [rule('symptom_end', 'symptom_end', 2, '', 'und weiter beschwerdefrei')],
      },
    },
    hint: `Mehrmaliger Durchfall oder Erbrechen: das Kind zu Hause lassen, bis es 48 Stunden beschwerdefrei ist. ${HYGIENE_HINT}`,
  },
  {
    key: 'hib', name: 'Haemophilus-influenzae-Typ-b-Meningitis', notify: true,
    kinds: {
      sick: {
        text: 'Nach klinischer Genesung, frühestens 24 Stunden nach Beginn einer wirksamen Antibiotikatherapie.', proof: MEDICAL,
        rules: [rule('antibiotic', 'antibiotic', 1, '', 'und genesen')],
      },
      household: {
        text: 'Mit Chemoprophylaxe 24–48 Stunden nach deren Beginn; ohne frühestens 10 Tage nach dem letzten Kontakt und beschwerdefrei – ärztliches Urteil.',
        proof: MEDICAL,
        rules: [
          rule('prophylaxis', 'prophylaxis', 1, 'mit Chemoprophylaxe', '24–48 Stunden nach Beginn'),
          rule('last_contact', 'last_contact', 10, 'ohne Chemoprophylaxe', 'und beschwerdefrei'),
        ],
      },
    },
    hint: 'Etwa 5 Tage lang auf Fieber, Müdigkeit und Gliederschmerzen achten; den Hib-Impfschutz von Kindern unter 5 Jahren prüfen lassen.',
  },
  {
    key: 'hepatitis_a', name: 'Hepatitis A', notify: true,
    kinds: {
      sick: {
        text: '2 Wochen nach den ersten Symptomen (ohne Gelbsucht) bzw. 1 Woche nach Beginn der Gelbsucht; auf gute Händehygiene achten.', proof: MEDICAL,
        rules: [rule('no_jaundice', 'onset', 14, 'ohne Gelbsucht'), rule('jaundice', 'jaundice', 7, 'mit Gelbsucht')],
      },
      household: {
        text: 'Kein Ausschluss bei nachgewiesener Immunität oder 2 Wochen nach einer Impfung nach dem Kontakt; ohne Immunität 30 Tage nach dem letzten Kontakt.',
        proof: MEDICAL, rules: [rule('last_contact', 'last_contact', 30, 'ohne Immunität')],
      },
    },
    hint: 'Auf Gelbfärbung der Haut oder Augen, dunklen Urin, Bauchschmerzen und Fieber achten; gründlich Hände waschen. Impfschutz prüfen lassen.',
  },
  {
    key: 'hepatitis_e', name: 'Hepatitis E', notify: true,
    kinds: {
      sick: { text: 'Nach klinischer Genesung, unter Beachtung guter Händehygiene.', proof: MEDICAL, rules: [] },
      household: { text: 'In der Regel bei guter persönlicher Hygiene (gründliches Händewaschen) wieder zuzulassen – ärztliches Urteil.', proof: MEDICAL, rules: [] },
    },
    hint: 'Auf Gelbfärbung der Haut oder Augen, Bauchschmerzen und Fieber achten; gründlich Hände mit Seife waschen.',
  },
  {
    key: 'impetigo', name: 'Impetigo contagiosa (Borkenflechte)', notify: true,
    kinds: {
      sick: {
        text: '24 Stunden nach Beginn einer wirksamen Antibiotikatherapie, wenn keine nässenden Stellen mehr da sind; ohne Antibiotika erst nach Abheilung der Hautstellen.',
        proof: MEDICAL, rules: [rule('antibiotic', 'antibiotic', 1, 'mit Antibiotikum', 'und keine nässenden Stellen')],
      },
    },
    hint: 'Auf eitrige, verkrustete Hautstellen achten und ärztlich abklären lassen; Hände gründlich waschen, Wäsche bei mindestens 60 °C.',
  },
  {
    key: 'keuchhusten', name: 'Keuchhusten (Pertussis/Parapertussis)', notify: true,
    kinds: {
      sick: {
        text: 'In der Regel 5 Tage nach Beginn einer wirksamen Antibiotikatherapie (Azithromycin ggf. nach 3 Tagen); ohne Antibiotika 21 Tage nach Hustenbeginn.',
        proof: MEDICAL,
        rules: [
          rule('antibiotic', 'antibiotic', 5, 'mit Antibiotikum'),
          rule('azithromycin', 'antibiotic', 3, 'mit Azithromycin'),
          rule('no_antibiotic', 'onset', 21, 'ohne Antibiotikum (ab Hustenbeginn)'),
        ],
      },
    },
    hint: 'Auf anhaltenden, anfallsartigen Husten achten und ärztlich abklären lassen; besonders Säuglinge und Schwangere schützen.',
  },
  {
    key: 'kopflaus', name: 'Kopflausbefall', notify: true,
    kinds: {
      sick: {
        text: 'Nach sachgerechter Behandlung mit einem Läusemittel und Auskämmen mit dem Läusekamm (am selben Tag möglich); die Wiederholungsbehandlung ist zwingend.',
        proof: MEDICAL, rules: [],
      },
    },
    hint: 'Bitte die Haare Ihres Kindes mit einem Läusekamm untersuchen und bei Befall behandeln; Wiederholungsbehandlung nicht vergessen.',
  },
  {
    key: 'masern', name: 'Masern', notify: true,
    kinds: {
      sick: {
        text: 'Nach ärztlicher Beurteilung frühestens am 5. Tag nach Beginn des Ausschlags.', proof: MEDICAL,
        rules: [rule('rash', 'rash', 5, '', 'nach ärztlicher Beurteilung')],
      },
      household: {
        text: 'Kein Ausschluss bei dokumentierter Immunität (Impfpass oder Laborbefund); ohne Immunität 21 Tage nach dem letzten Kontakt.',
        proof: MEDICAL, rules: [rule('last_contact', 'last_contact', 21, 'ohne Immunität')],
      },
    },
    hint: 'Bis zu 21 Tage lang auf Fieber, Schnupfen, Husten, Bindehautentzündung und Ausschlag achten; vor dem Arztbesuch anrufen. Impfpass prüfen.',
  },
  {
    key: 'meningokokken', name: 'Meningokokken-Infektion', notify: true,
    kinds: {
      sick: {
        text: 'Nach klinischer Genesung, frühestens 24 Stunden nach Beginn einer wirksamen Antibiotikatherapie.', proof: MEDICAL,
        rules: [rule('antibiotic', 'antibiotic', 1, '', 'und genesen')],
      },
      household: {
        text: '24 Stunden nach Beginn einer Chemoprophylaxe; ohne Chemoprophylaxe frühestens 10 Tage nach dem Kontakt.', proof: MEDICAL,
        rules: [
          rule('prophylaxis', 'prophylaxis', 1, 'mit Chemoprophylaxe'),
          rule('last_contact', 'last_contact', 10, 'ohne Chemoprophylaxe'),
        ],
      },
    },
    hint: '10 Tage lang auf Fieber, Kopfschmerzen, Nackensteifigkeit, Übelkeit und Lichtempfindlichkeit achten und sofort ärztliche Hilfe holen.',
  },
  {
    key: 'mumps', name: 'Mumps', notify: true,
    kinds: {
      sick: {
        text: 'Nach Abklingen der Symptome, frühestens 5 Tage nach Erkrankungsbeginn.', proof: MEDICAL,
        rules: [rule('onset', 'onset', 5, '', 'und symptomfrei')],
      },
      household: {
        text: 'Kein Ausschluss bei ausreichender Immunität oder nach einer Impfung; sonst 18 Tage nach dem letzten Kontakt.', proof: MEDICAL,
        rules: [rule('last_contact', 'last_contact', 18, 'ohne Immunität')],
      },
    },
    hint: 'Auf Fieber, Kopfschmerzen und Schwellung der Ohrspeicheldrüse achten; vor dem Arztbesuch anrufen. Impfpass prüfen.',
  },
  {
    key: 'orthopocken', name: 'Orthopocken (z. B. Mpox)', notify: true,
    kinds: {
      sick: {
        text: 'Nach Abklingen der Symptome und Abheilung aller Hautstellen (neue Hautschicht), frühestens 21 Tage nach Symptombeginn.', proof: MEDICAL,
        rules: [rule('onset', 'onset', 21, '', 'und alle Hautstellen abgeheilt')],
      },
    },
    hint: 'Auf Fieber und Hautausschlag mit Bläschen achten und ärztlich abklären lassen; engen Hautkontakt meiden.',
  },
  {
    key: 'pest', name: 'Pest', notify: true,
    kinds: {
      sick: { text: 'Nur in Abstimmung mit Fachleuten und dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      household: {
        text: '72 Stunden nach Beginn einer geeigneten vorbeugenden Antibiotikagabe – in Abstimmung mit dem Gesundheitsamt.', proof: OFFICE,
        rules: [rule('prophylaxis', 'prophylaxis', 3, 'mit Postexpositionsprophylaxe')],
      },
    },
    hint: 'Das Gesundheitsamt informiert über alle weiteren Maßnahmen; bei Fieber sofort ärztliche Hilfe holen.',
  },
  {
    key: 'polio', name: 'Poliomyelitis (Kinderlähmung)', notify: true,
    kinds: {
      sick: { text: 'Nur in Abstimmung mit Fachleuten und dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      household: { text: 'Nur in Abstimmung mit Fachleuten und dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: 'Bitte den Impfpass prüfen und fehlende Polio-Impfungen sofort nachholen lassen; das Gesundheitsamt informiert über weitere Maßnahmen.',
  },
  {
    key: 'roeteln', name: 'Röteln', notify: true,
    kinds: {
      sick: {
        text: 'Nach Abklingen der Symptome, frühestens am 8. Tag nach Beginn des Ausschlags.', proof: MEDICAL,
        rules: [rule('rash', 'rash', 8, '', 'und symptomfrei')],
      },
      household: {
        text: 'Kein Ausschluss bei dokumentierter Immunität (Impfpass oder Laborbefund); ohne Immunität 21 Tage nach dem letzten Kontakt.',
        proof: MEDICAL, rules: [rule('last_contact', 'last_contact', 21, 'ohne Immunität')],
      },
    },
    hint: 'Auf Ausschlag und geschwollene Lymphknoten achten; Schwangere ohne Immunität sollen die Einrichtung meiden und ärztlich beraten werden.',
  },
  {
    key: 'scharlach', name: 'Scharlach / Streptococcus-pyogenes-Infektion', notify: true,
    kinds: {
      sick: {
        text: '24 Stunden nach Beginn einer wirksamen Antibiotikatherapie, wenn die Symptome abgeklungen sind; ohne Antibiotika frühestens 24 Stunden nach Abklingen der Symptome.',
        proof: MEDICAL,
        rules: [
          rule('antibiotic', 'antibiotic', 1, 'mit Antibiotikum', 'und symptomfrei'),
          rule('no_antibiotic', 'symptom_end', 1, 'ohne Antibiotikum (ab Ende der Symptome)'),
        ],
      },
    },
    hint: 'Auf Halsschmerzen, Fieber und Ausschlag achten und ärztlich abklären lassen; Hände gründlich waschen.',
  },
  {
    key: 'shigellose', name: 'Shigellose (bakterielle Ruhr)', notify: true,
    kinds: {
      sick: { text: 'Nach Abklingen der Symptome und 2 negativen Stuhlproben – nur nach ärztlicher Feststellung und Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      carrier: carrier('Nach 2 negativen Stuhlproben im Abstand von 1–2 Tagen ist wieder zuzulassen.'),
      household: { text: 'Nach einer negativen Stuhlprobe, 96 Stunden nach dem letzten Kontakt entnommen – Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: HYGIENE_HINT,
  },
  {
    key: 'skabies', name: 'Skabies (Krätze)', notify: true,
    kinds: {
      sick: {
        text: 'Direkt nach abgeschlossener Behandlung mit einem Mittel zum Auftragen bzw. 24 Stunden nach Einnahme von Ivermectin (nicht bei Scabies crustosa).',
        proof: MEDICAL,
        rules: [rule('topical', 'treatment', 0, 'Behandlung zum Auftragen (abgeschlossen)'), rule('ivermectin', 'treatment', 1, 'Ivermectin (Einnahme)')],
      },
    },
    hint: '5–6 Wochen lang auf juckenden Ausschlag achten und bei Beschwerden ärztlich abklären lassen; enge Hautkontakte meiden.',
  },
  {
    key: 'tuberkulose', name: 'Ansteckungsfähige Lungentuberkulose', notify: true,
    kinds: {
      sick: { text: 'Immer eine ärztliche Einzelfallentscheidung; in der Regel frühestens 3 Wochen nach Beginn einer wirksamen Behandlung.', proof: MEDICAL, rules: [] },
      household: { text: 'Nach den Kontrolluntersuchungen des Gesundheitsamtes; auf Husten unklarer Ursache achten.', proof: OFFICE, rules: [] },
    },
    hint: 'Auf länger anhaltenden Husten unklarer Ursache achten; das Gesundheitsamt informiert über Untersuchungen.',
  },
  {
    key: 'typhus', name: 'Typhus / Paratyphus', notify: true,
    kinds: {
      sick: { text: 'Nach klinischer Genesung und 3 negativen Stuhlproben (die erste frühestens 48 Stunden nach Therapieende) – nur nach ärztlicher Feststellung und Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      carrier: carrier('Nach 3 negativen Stuhlproben im Abstand von je 2 Tagen ist wieder zuzulassen.'),
      household: { text: 'Nach 3 negativen Stuhlproben im Abstand von je 1–2 Tagen – Rücksprache mit dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: HYGIENE_HINT,
  },
  {
    key: 'vhf', name: 'Virusbedingtes hämorrhagisches Fieber (VHF)', notify: true,
    kinds: {
      sick: { text: 'Nur in Abstimmung mit Fachleuten und dem Gesundheitsamt.', proof: OFFICE, rules: [] },
      household: { text: 'Nur in Abstimmung mit Fachleuten und dem Gesundheitsamt.', proof: OFFICE, rules: [] },
    },
    hint: 'Das Gesundheitsamt informiert über alle weiteren Maßnahmen; bei Fieber sofort ärztliche Hilfe holen.',
  },
  {
    key: 'windpocken', name: 'Windpocken (Varizellen)', notify: true,
    kinds: {
      sick: {
        text: 'Eine Woche nach Beginn einer unkomplizierten Erkrankung, wenn alle Bläschen verkrustet sind.', proof: MEDICAL,
        rules: [rule('onset', 'onset', 7, '', 'und alle Bläschen verkrustet')],
      },
      household: {
        text: 'Kein Ausschluss bei anzunehmender Immunität; ohne Immunität 16 Tage nach dem letzten Kontakt.', proof: MEDICAL,
        rules: [rule('last_contact', 'last_contact', 16, 'ohne Immunität')],
      },
    },
    hint: 'Bis zu 3 Wochen lang auf Fieber und juckenden Bläschenausschlag achten; Schwangere ohne Immunität ärztlich beraten lassen. Impfpass prüfen.',
  },
]

/** The RKI catalogue: every disease is binding (§ 34 forbids the visit) and comes from the RKI. */
export const IFSG_CATALOGUE: readonly IfsgDisease[] = RKI_DISEASES.map(disease => ({ ...disease, binding: true, source: 'rki' as const }))

/** The disease of these rules with the key; null for an unknown one. */
export function ifsgDisease(rules: readonly IfsgDisease[], key: string): IfsgDisease | null {
  return rules.find(disease => disease.key === key) ?? null
}

/** The kinds that apply to a disease, in the order sick, carrier, household. */
export function ifsgKinds(disease: IfsgDisease): IfsgKind[] {
  return IFSG_KINDS.filter(kind => disease.kinds[kind] !== undefined)
}

/** The date rule of the disease's kind with the key; null when the kind or the rule does not exist. */
export function ifsgDateRule(disease: IfsgDisease, kind: IfsgKind, key: string): IfsgDateRule | null {
  return disease.kinds[kind]?.rules.find(entry => entry.key === key) ?? null
}

/**
 * The earliest readmission under the rule: its days after the onset (anchor `onset`) or after the rule's own date;
 * null without a rule or while that date is not known.
 */
export function earliestReadmission(rule: IfsgDateRule | null, onsetDate: IsoDate, ruleDate: IsoDate | null): IsoDate | null {
  if (rule === null) return null
  const base = rule.anchor === 'onset' ? onsetDate : ruleDate
  return base === null ? null : addDays(base, rule.days)
}
