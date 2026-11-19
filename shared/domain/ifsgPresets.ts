import { IFSG_CATALOGUE, type IfsgAnchor, type IfsgProof } from './ifsg'
import { emptyLocalRule, type IfsgLocalDateRule, type IfsgLocalRule } from './ifsgLocal'

// Presets for the local rules of the health office: „RKI-Werte übernehmen“ copies the catalogue into local rows, the
// preset of the Gesundheitsamt Rhein-Neckar-Kreis/Heidelberg reproduces its „Meldepflichten und Wiederzulassung in
// Gemeinschaftseinrichtungen nach § 34 Infektionsschutzgesetz“ (Version 2.0, Stand Januar 2024), pages 2–4, including
// COVID-19, RSV and the non-notifiable diseases.

export type IfsgPresetKey = 'rki' | 'rnk_2024'
export const IFSG_PRESET_KEYS: readonly IfsgPresetKey[] = ['rki', 'rnk_2024']

/** The local rows that copy the RKI catalogue: every field set to the RKI value. */
export function rkiPreset(): IfsgLocalRule[] {
  return IFSG_CATALOGUE.map(disease => ({
    ...emptyLocalRule(disease.key),
    text: disease.kinds.sick?.text ?? null,
    rules: (disease.kinds.sick?.rules ?? []).map(rule => ({ anchor: rule.anchor, days: rule.days, label: rule.label, condition: rule.condition })),
    proof: disease.kinds.sick?.proof ?? null,
    notify: null,
    householdText: disease.kinds.household?.text ?? null,
    householdExclusion: disease.kinds.household !== undefined,
  }))
}

/** A date rule of the preset; without `condition` a rule equal to the RKI's (anchor and days) keeps the RKI condition. */
const r = (anchor: IfsgAnchor, days: number, label = '', condition?: string): IfsgLocalDateRule =>
  (condition === undefined ? { anchor, days, label } : { anchor, days, label, condition })

const OFFICE_TEXT = 'Rücksprache mit dem Gesundheitsamt (schriftliches ärztliches Attest nach Rücksprache mit dem Gesundheitsamt).'
/** „Xi“: the healthy household members without immunity are excluded. */
const NOT_IMMUNE = 'Zutrittsverbot für nicht immune Haushaltsmitglieder.'
/** „Xk“: a decision in the single case together with the health office. */
const SINGLE_CASE = 'Einzelfallentscheidung in Abstimmung mit dem Gesundheitsamt.'
/** „Xa“ in the column of the sick: healthy carriers are excluded as well (the RKI's Abs. 2). */
const CARRIERS = 'Zutrittsverbot auch für gesunde Ausscheider.'
const TREAT_ALL = 'Kein Zutrittsverbot, aber Empfehlung: Behandlung aller Mitglieder der Wohngemeinschaft.'

/**
 * A row of the document. `rules` left out: the document gives no days, the RKI date rules stay (an RKI disease) or
 * there is no date (a local one).
 */
interface Row {
  key: string
  name?: string
  notifiable?: boolean
  text: string
  rules?: IfsgLocalDateRule[]
  proof: IfsgProof
  notify: boolean
  household?: { exclusion: boolean; text: string }
  note?: string
}

/** A row of the preset as a local rule (an RKI disease unless it has a name). */
const row = (entry: Row): IfsgLocalRule => ({
  ...emptyLocalRule(entry.key),
  custom: entry.name !== undefined,
  name: entry.name ?? null,
  notifiable: entry.name !== undefined ? entry.notifiable ?? false : null,
  text: entry.text,
  rules: entry.rules ?? (entry.name !== undefined ? [] : null),
  proof: entry.proof,
  // The notification duty of an RKI disease stands by law; the row's value counts for a local disease only.
  notify: entry.name !== undefined ? entry.notify : null,
  householdText: entry.household?.text ?? null,
  householdExclusion: entry.household?.exclusion ?? null,
  note: entry.note ?? null,
})

/** A health office row with stool samples or a consultation: the health office decides. */
const office = (key: string, samples: string, household: { exclusion: boolean; text: string }, carriers = true): Row => ({
  key, proof: 'health_office', notify: true, household,
  text: [samples, carriers ? CARRIERS : '', OFFICE_TEXT].filter(Boolean).join(' '),
})

/** A non-notifiable disease of page 4: a recommendation only, no notification. */
const recommendation = (key: string, name: string, text: string, stayHome: boolean, proof: IfsgProof = 'none'): Row => ({
  key, name, notifiable: false, notify: false, proof,
  text: stayHome ? `Empfehlung: Zutritts- bzw. Tätigkeitsbeschränkung. Wiederzulassung: ${text}` : `Wiederzulassung: ${text}`,
})

const RNK_ROWS: Row[] = [
  // Page 2.
  {
    key: 'impetigo', proof: 'parent_declaration', notify: true,
    text: 'Bei wirksamer Antibiotikatherapie nach 24 h, ohne Antibiotikum erst nach Abheilen der betroffenen Hautareale.',
    rules: [r('antibiotic', 1, 'mit Antibiotikum')],
  },
  {
    key: 'keuchhusten', proof: 'parent_declaration', notify: true,
    text: 'Mit Antibiotikum nach 5 Tagen, ohne Antibiotikum nach 3 Wochen (21 Tage).',
    rules: [r('antibiotic', 5, 'mit Antibiotikum'), r('onset', 21, 'ohne Antibiotikum')],
  },
  {
    key: 'skabies', proof: 'parent_declaration', notify: true,
    text: 'Nach abgeschlossener topischer Behandlung (Lotion), 24 h nach Ivermectin (Tabletten).',
    rules: [r('treatment', 0, 'Lotion (abgeschlossen)'), r('treatment', 1, 'Ivermectin (Tabletten)')],
    household: { exclusion: false, text: TREAT_ALL },
    note: 'Beim ersten Auftreten Elternerklärung, nur im Wiederholungsfall ärztliches Attest.',
  },
  {
    key: 'gastroenteritis', proof: 'none', notify: true,
    text: 'Sistieren der Symptome (u. a. geformter Stuhl, kein Erbrechen); bei Verdacht auf ansteckende Durchfallerkrankungen (u. a. Noro-, Rotaviren) 48 h Symptomfreiheit empfohlen, Rücksprache mit dem Gesundheitsamt bei Kindern in Gruppen mit Säuglingen; kein Ausschluss gesunder Ausscheider.',
    rules: [r('symptom_end', 2)],
  },
  {
    key: 'scharlach', proof: 'none', notify: true,
    text: '24 h nach Beginn einer wirksamen Antibiotikatherapie sowie Abklingen der Symptome, ohne Antibiotikum frühestens 24 h nach Abklingen der spezifischen Symptome.',
    rules: [r('antibiotic', 1, 'mit Antibiotikum'), r('symptom_end', 1, 'ohne Antibiotikum')],
  },
  {
    key: 'kopflaus', proof: 'parent_declaration', notify: true,
    text: 'Nach der ersten von zwei Behandlungen; siehe Homepage des Gesundheitsamtes (Elternbrief Kopflausbefall).',
    rules: [r('treatment', 0, 'nach der ersten Behandlung')],
    household: { exclusion: false, text: TREAT_ALL },
  },
  {
    key: 'windpocken', proof: 'parent_declaration', notify: true,
    text: '1 Woche (7 Tage) nach Beginn einer unkomplizierten Erkrankung, d. h. mit Verkrusten aller Bläschen.',
    rules: [r('onset', 7)],
    household: { exclusion: true, text: NOT_IMMUNE },
  },
  {
    key: 'covid19', name: 'COVID-19', notifiable: false, proof: 'none', notify: false,
    text: 'Empfehlung: Zutritts- oder Tätigkeitsbeschränkung bis klinisch genesen.',
    note: 'Meldung durch die Einrichtung nur erforderlich, wenn Symptome bestehen und mindestens ein professioneller Schnelltest vorliegt.',
  },
  {
    key: 'rsv', name: 'RSV (Respiratorisches Synzytial-Virus)', notifiable: false, proof: 'none', notify: false,
    text: 'Empfehlung: Zutritts- oder Tätigkeitsbeschränkung bis klinisch genesen.',
  },
  // Page 3.
  office('cholera', '3 negative Stuhlproben.', { exclusion: true, text: NOT_IMMUNE }),
  office('diphtherie', '', { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' }),
  office('ehec', '2 negative Stuhlproben.', { exclusion: true, text: SINGLE_CASE }),
  office('vhf', '', { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' }, false),
  office('hib', '', { exclusion: true, text: SINGLE_CASE }, false),
  office('meningokokken', '', { exclusion: true, text: SINGLE_CASE }, false),
  office('tuberkulose', '', { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' }, false),
  {
    key: 'masern', proof: 'parent_declaration', notify: true, text: 'Frühestens 5 Tage nach Beginn des Ausschlags.',
    rules: [r('rash', 5, '', '')], household: { exclusion: true, text: NOT_IMMUNE },
  },
  {
    key: 'mumps', proof: 'parent_declaration', notify: true, text: 'Frühestens 5 Tage nach Beginn der Drüsenschwellung.',
    rules: [r('gland_swelling', 5)], household: { exclusion: true, text: NOT_IMMUNE },
  },
  // Paratyphus and Typhus abdominalis have the same row; the catalogue has one disease for both.
  office('typhus', '3 negative Stuhlproben.', { exclusion: true, text: SINGLE_CASE }),
  office('shigellose', '2 negative Stuhlproben.', { exclusion: true, text: SINGLE_CASE }),
  office('pest', '', { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' }, false),
  office('polio', '', { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' }, false),
  {
    key: 'hepatitis_a', proof: 'parent_declaration', notify: true,
    text: '1 Woche nach Beginn der Gelbfärbung; ohne Gelbsucht laut RKI 2 Wochen nach den ersten Symptomen.',
    // The document names only the jaundice; the RKI rule without jaundice (frequent in small children) stays.
    rules: [r('jaundice', 7, 'mit Gelbsucht'), r('onset', 14, 'ohne Gelbsucht (laut RKI)')], household: { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' },
  },
  {
    key: 'hepatitis_e', proof: 'parent_declaration', notify: true, text: '1 Woche nach Beginn der Gelbfärbung.',
    rules: [r('jaundice', 7)], household: { exclusion: true, text: 'Zutrittsverbot auch für gesunde Haushaltsmitglieder.' },
  },
  {
    key: 'roeteln', proof: 'parent_declaration', notify: true, text: 'Frühestens 8 Tage nach Exanthembeginn, Abklingen der klinischen Symptome.',
    rules: [r('rash', 8)], household: { exclusion: true, text: NOT_IMMUNE },
  },
  {
    key: 'orthopocken', proof: 'medical_certificate', notify: true,
    text: `${SINGLE_CASE} Nach Abklingen der klinischen Symptome und wenn alle Läsionen, auch Schorf, abgeheilt sind und sich eine neue Hautschicht gebildet hat, 21 Tage.`,
    rules: [r('onset', 21)], household: { exclusion: true, text: SINGLE_CASE },
  },
  // Page 4: not notifiable, orienting recommendations.
  recommendation('erkaeltung', 'Erkältung ohne Fieber', 'kein Ausschlussgrund.', false),
  recommendation('grippaler_infekt', 'Grippaler Infekt mit Fieber (> 38 °C)', '24 h fieberfrei, Genesung.', true),
  recommendation('dreitagefieber', '3-Tage-Fieber', '24 h fieberfrei.', true),
  recommendation('adenovirus_konjunktivitis', 'Endemische Adenovirus-Bindehautentzündung', 'Genesung, wenn kein Sekret und keine Rötung mehr zu sehen sind (Elternerklärung, ggf. Attest).', true, 'parent_declaration'),
  recommendation('hand_fuss_mund', 'Hand-Fuß-Mund-Krankheit', 'klinische Genesung und Eintrocknen der Bläschen.', true),
  recommendation('pfeiffer', 'Pfeiffersches Drüsenfieber', 'klinische Genesung.', false),
  recommendation('ringelroeteln', 'Ringelröteln', 'klinische Genesung.', false),
  recommendation('dellwarzen', 'Dellwarzen', 'kein Ausschlussgrund.', false),
  recommendation('lippenherpes', 'Lippenherpes', 'kein Ausschlussgrund.', false),
  recommendation('madenwuermer', 'Madenwürmer', 'Empfehlung: medikamentöse Behandlung.', false),
]

/** The preset of the Gesundheitsamt Rhein-Neckar-Kreis/Heidelberg (Stand 01/2024) as local rules. */
export function rnkPreset(): IfsgLocalRule[] {
  return RNK_ROWS.map(row)
}

/** The local rows of a preset. */
export function presetRules(preset: IfsgPresetKey): IfsgLocalRule[] {
  return preset === 'rki' ? rkiPreset() : rnkPreset()
}

/** The health office of the RNK preset (its name; the phone of its contact for Gemeinschaftseinrichtungen). */
export const RNK_HEALTH_OFFICE = { name: 'Rhein-Neckar-Kreis/Heidelberg', phone: '06221 522-1817' }
