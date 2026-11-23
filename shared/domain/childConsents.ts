// The facility's own consent questions (Einwilligungen & Erlaubnisse) and the tabs of the children overview
// (Kinder → Übersicht). Every facility starts with the questions and tabs below; the migration
// 0111_child_consent_questions gave the existing facilities exactly these (with the answers of the former fixed
// columns), createFacility seeds them for a new one. The texts are data the facility may change afterwards.

/** The questions that were fixed columns of `children` before 0111 (`builtin_key`); their answers moved over. */
export const BUILTIN_CONSENT_KEYS = [
  'artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosNamesBirthdaysDisplay',
  'groupWorkWithNames', 'whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup',
  'mayTakeTemperature', 'mayApplySunscreen', 'mayApplyPlaster', 'insectRepellent',
] as const
export type BuiltinConsentKey = typeof BUILTIN_CONSENT_KEYS[number]

/** The question about insect repellent: the attendance list shows its „nein“ (the key stays when the text changes). */
export const INSECT_REPELLENT_KEY: BuiltinConsentKey = 'insectRepellent'

export const CONSENT_TEXT_MAX = 300
export const CONSENT_SHORT_MAX = 40
export const CONSENT_AREA_MAX = 40
export const SHEET_NAME_MAX = 40
/** More columns than any sheet sensibly has (a guard against a broken request). */
export const SHEET_COLUMNS_MAX = 60

export interface DefaultConsentQuestion {
  builtinKey: BuiltinConsentKey
  area: string
  /** The column head of the overview. */
  short: string
  /** The full question, as in the record. */
  text: string
}

const PRIVACY = 'Datenschutz'
const MESSENGER = 'Messenger (WhatsApp, Signal)'
const HEALTH = 'Gesundheit'

/** In this order (areas in the order of their first question): the record's blocks and the overview as before. */
export const DEFAULT_CONSENT_QUESTIONS: readonly DefaultConsentQuestion[] = [
  { builtinKey: 'artworkDisplay', area: PRIVACY, short: 'Bastelarbeiten', text: 'Bastel- und Malarbeiten aufhängen' },
  { builtinKey: 'photosDisplay', area: PRIVACY, short: 'Fotos aufhängen', text: 'Einzel- und Gruppenfotos aufhängen' },
  { builtinKey: 'photosForeignPortfolios', area: PRIVACY, short: 'Fremde Portfolios', text: 'Fotoerlaubnis für fremde Portfolios' },
  { builtinKey: 'photosInternalEvents', area: PRIVACY, short: 'Fotos Feste', text: 'Fotos hausinterner Feste' },
  { builtinKey: 'photosNamesBirthdaysDisplay', area: PRIVACY, short: 'Fotos, Namen, Geb.', text: 'Fotos, Namen und Geburtsdaten aufhängen' },
  { builtinKey: 'groupWorkWithNames', area: PRIVACY, short: 'Gruppenarbeiten', text: 'Gruppenarbeiten mit Namen ausstellen' },
  { builtinKey: 'whatsappContact', area: MESSENGER, short: 'Kontakt WhatsApp', text: 'Kontaktaufnahme über WhatsApp' },
  { builtinKey: 'whatsappPhotos', area: MESSENGER, short: 'Fotos WhatsApp', text: 'Fotos über WhatsApp versenden' },
  { builtinKey: 'signalPhotos', area: MESSENGER, short: 'Fotos Signal', text: 'Fotos über Signal versenden' },
  { builtinKey: 'whatsappParentGroup', area: MESSENGER, short: 'Elterngruppe', text: 'WhatsApp-Elterngruppe' },
  { builtinKey: 'mayTakeTemperature', area: HEALTH, short: 'Fieber', text: 'Fieber messen' },
  { builtinKey: 'mayApplySunscreen', area: HEALTH, short: 'Sonnenschutz', text: 'Sonnenschutz auftragen' },
  { builtinKey: 'mayApplyPlaster', area: HEALTH, short: 'Pflaster', text: 'Pflaster kleben' },
  { builtinKey: 'insectRepellent', area: HEALTH, short: 'Insektenschutz', text: 'Darf mit Insektenschutz eingesprüht werden' },
]

/**
 * The fixed fields a tab can show besides the consent questions (the cell renderers of app/utils/childrenOverview.ts).
 * `emergency` and `phones` expand to one column per contact (as many as the most a listed child has).
 */
export const OVERVIEW_FIELD_KEYS = [
  'birthday', 'group', 'address', 'school', 'measlesProof', 'infectionBriefingDate', 'allergies', 'pickUp', 'guardians',
  'contactBan', 'emergency', 'phones', 'lastMeeting', 'nextMeeting', 'allMeetings', 'meetingCount',
] as const
export type OverviewFieldKey = typeof OVERVIEW_FIELD_KEYS[number]
export const isOverviewFieldKey = (value: unknown): value is OverviewFieldKey =>
  (OVERVIEW_FIELD_KEYS as readonly unknown[]).includes(value)

/** A column of a tab: a consent question of the facility or a fixed field. */
export type OverviewColumnRef = { type: 'consent'; questionId: number } | { type: 'field'; key: OverviewFieldKey }

/** A default tab's column: the consent questions by their key (each facility has its own ids). */
export type DefaultColumnRef = { type: 'consent'; builtinKey: BuiltinConsentKey } | { type: 'field'; key: OverviewFieldKey }

const consent = (builtinKey: BuiltinConsentKey): DefaultColumnRef => ({ type: 'consent', builtinKey })
const field = (key: OverviewFieldKey): DefaultColumnRef => ({ type: 'field', key })

/** The eight tabs the overview had as fixed sheets, with the same columns. */
export const DEFAULT_OVERVIEW_SHEETS: readonly { name: string; columns: readonly DefaultColumnRef[] }[] = [
  {
    name: 'Datenschutz',
    columns: (['artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosNamesBirthdaysDisplay', 'groupWorkWithNames'] as const).map(consent),
  },
  { name: 'Messenger', columns: (['whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup'] as const).map(consent) },
  {
    name: 'Gesundheit',
    columns: [
      field('measlesProof'), field('infectionBriefingDate'), field('allergies'),
      ...(['mayTakeTemperature', 'mayApplySunscreen', 'mayApplyPlaster', 'insectRepellent'] as const).map(consent),
    ],
  },
  { name: 'Abholberechtigte', columns: [field('pickUp')] },
  { name: 'Sorgeberechtigte', columns: [field('guardians'), field('contactBan')] },
  { name: 'Anruf-Reihenfolge', columns: [field('emergency')] },
  { name: 'Telefonnummern', columns: [field('address'), field('phones')] },
  { name: 'Elterngespräche', columns: [field('lastMeeting'), field('nextMeeting'), field('allMeetings'), field('meetingCount')] },
]

/** The areas in the order of their first question. */
export function consentAreas(questions: readonly { area: string }[]): string[] {
  return [...new Set(questions.map(question => question.area))]
}

/** The questions grouped by area (areas in the order of their first question, questions in their order). */
export function groupByArea<T extends { area: string }>(questions: readonly T[]): { area: string; questions: T[] }[] {
  return consentAreas(questions).map(area => ({ area, questions: questions.filter(question => question.area === area) }))
}
