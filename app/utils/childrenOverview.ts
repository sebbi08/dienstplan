// The columns of the Excel-like overview tables ("Übersicht" under "Kinder"): each tab of the facility lists its
// columns (consent questions and fixed fields, Einstellungen → Kinder → Reiter der Übersicht); the cells are rendered
// here. The texts are imported relative so a test can load this file.
import { callOrder } from '#shared/domain/callOrder'
import type { DefaultColumnRef, OverviewColumnRef, OverviewFieldKey } from '#shared/domain/childConsents'
import { parseIsoDate } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type {
  ChildrenOverviewDto, ChildrenOverviewRowDto, ConsentQuestionDto, OverviewContactDto, OverviewMeetingDto, OverviewSheetDto, TriState,
} from '#shared/types/api'
import { de } from '../locales/de'

/** A person in a cell: the name line, small lines below it (phone numbers, the note of a contact ban), red when banned. */
export interface OverviewLine {
  text: string
  details: string[]
  danger: boolean
}

/** A cell: a yes / no / open answer (with a date for the measles proof), a text, or a list of persons. */
export type OverviewCell =
  | { kind: 'tri'; value: TriState; date: string }
  | { kind: 'text'; text: string }
  | { kind: 'lines'; lines: OverviewLine[] }

export interface OverviewColumn {
  key: string
  /** The short head. */
  label: string
  /** The full text, shown as hint on the head. */
  title: string
  cell: (row: ChildrenOverviewRowDto) => OverviewCell
  /** A free text that may be long (allergies, address): gets room on screen. Lists of persons always do. */
  wide?: boolean
}

const t = de.children.overview

/** ✓ yes, ✗ no, – open. */
export const triSymbol = (value: TriState): '✓' | '✗' | '–' => (value === true ? '✓' : value === false ? '✗' : '–')
/** "ja", "nein", "offen" (for screen readers next to the symbol). */
export const triText = (value: TriState): string =>
  value === true ? de.children.triState.yes : value === false ? de.children.triState.no : de.children.triState.open

const pad = (value: number) => String(value).padStart(2, '0')
const dateText = (iso: string | null): string => {
  if (!iso) return ''
  const { year, month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.${year}`
}

/** "04.03.27" (the list of all meetings). */
const shortDateText = (iso: string): string => {
  const { year, month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.${pad(year % 100)}`
}

const kindText = (meeting: OverviewMeetingDto): string => de.parentMeetings.kinds[meeting.kind]
/** The latest meeting that took place (the list is newest first). */
const lastMeeting = (row: ChildrenOverviewRowDto): OverviewMeetingDto | undefined => row.meetings.find(meeting => !meeting.planned)
/** The nearest planned meeting: the earliest of those ahead. */
const nextMeeting = (row: ChildrenOverviewRowDto): OverviewMeetingDto | undefined =>
  row.meetings.filter(meeting => meeting.planned).reduce<OverviewMeetingDto | undefined>((nearest, meeting) =>
    !nearest || meeting.date < nearest.date || (meeting.date === nearest.date && meeting.start < nearest.start) ? meeting : nearest, undefined)

/** "Erika Muster (Oma)", without the parentheses when the relation is empty. */
export const contactLabel = (contact: Pick<OverviewContactDto, 'name' | 'relation'>): string =>
  contact.relation.trim() ? `${contact.name} (${contact.relation.trim()})` : contact.name

/** The filled-in phone numbers: "privat …", "mobil …", "Arbeit …". */
const phoneLines = (contact: OverviewContactDto): string[] => [
  [t.phoneHome, contact.phoneHome], [t.phoneMobile, contact.phoneMobile], [t.phoneWork, contact.phoneWork],
].filter(([, number]) => number!.trim() !== '').map(([label, number]) => `${label} ${number!.trim()}`)

/** A person in a list; a contact ban is named in the text ("… – Kontaktverbot"), not only shown in red. */
const person = (contact: OverviewContactDto, details: string[] = []): OverviewLine => ({
  text: contact.contactBan ? `${contactLabel(contact)} – ${de.children.contactBan}` : contactLabel(contact),
  details,
  danger: contact.contactBan,
})
const lines = (list: OverviewLine[]): OverviewCell => ({ kind: 'lines', lines: list })
const tri = (value: TriState, date = ''): OverviewCell => ({ kind: 'tri', value, date })
const text = (value: string): OverviewCell => ({ kind: 'text', text: value })

/** A consent question: its short name on the head, the full question as hint, ja / nein / offen in the cells. */
const consent = (question: ConsentQuestionDto): OverviewColumn => ({
  key: `q${question.id}`, label: question.short, title: question.text, cell: row => tri(row.consents[question.id] ?? null),
})

/** The sheet "Anruf-Reihenfolge": as the "Wichtig" box – parents first, then the others with a number, no bans. */
const emergencyContacts = (row: ChildrenOverviewRowDto): OverviewContactDto[] =>
  callOrder(row.contacts, { withUnnumbered: false })

/** The phone sheet: everyone in call order, the contacts with a contact ban at the very end (marked red). */
const phoneContacts = (row: ChildrenOverviewRowDto): OverviewContactDto[] => callOrder(row.contacts, { withBanned: true })

/** As many columns as the most a child has, at least one (so the sheet still shows its rows). */
const columnCount = (rows: ChildrenOverviewRowDto[], count: (row: ChildrenOverviewRowDto) => number): number =>
  Math.max(1, ...rows.map(count))

/** What the cells need beyond the row: the facility's questions and the listed groups (for the group's name). */
export interface OverviewContext {
  questions: readonly ConsentQuestionDto[]
  groups: ChildrenOverviewDto['groups']
}

const meetingText = (meeting: OverviewMeetingDto | undefined, withTime: boolean) =>
  meeting ? [dateText(meeting.date), ...(withTime ? [formatTime(meeting.start)] : []), kindText(meeting)].join(' ') : ''

/** The column(s) of a fixed field; the call order and the phone numbers expand to one column per contact. */
function fieldColumns(key: OverviewFieldKey, rows: ChildrenOverviewRowDto[], context: OverviewContext): OverviewColumn[] {
  switch (key) {
    case 'birthday':
      return [{ key, label: t.short.birthday, title: t.birthdayTitle, cell: row => text(dateText(row.birthDate)) }]
    case 'group': {
      const names = new Map(context.groups.map(group => [group.id, group.name]))
      return [{
        key, label: t.short.group, title: t.groupTitle,
        cell: row => text(row.groupId === null ? de.children.noGroup : names.get(row.groupId) ?? ''),
      }]
    }
    case 'address':
      return [{ key, label: t.short.address, title: de.children.fields.address, cell: row => text(row.address), wide: true }]
    case 'school':
      return [{ key, label: t.short.school, title: t.schoolTitle, cell: row => text(row.school), wide: true }]
    case 'measlesProof':
      return [{ key, label: t.short.measlesProof, title: t.measlesTitle, cell: row => tri(row.measlesProof, dateText(row.measlesProofDate)) }]
    case 'infectionBriefingDate':
      return [{ key, label: t.short.infectionBriefingDate, title: t.infectionBriefingTitle, cell: row => text(dateText(row.infectionBriefingDate)) }]
    case 'allergies':
      return [{ key, label: t.short.allergies, title: de.children.fields.allergiesText, cell: row => text(row.allergies), wide: true }]
    case 'pickUp':
      return [{
        key, label: t.short.pickUp, title: t.pickUpTitle,
        cell: row => lines(row.contacts.filter(contact => contact.mayPickUp && !contact.contactBan).map(contact => person(contact))),
      }]
    case 'guardians':
      return [{ key, label: t.short.guardians, title: t.guardiansTitle, cell: row => lines(row.contacts.filter(contact => contact.isGuardian).map(contact => person(contact))) }]
    case 'contactBan':
      return [{
        key, label: t.short.contactBan, title: t.contactBanTitle,
        cell: row => lines(row.contacts.filter(contact => contact.contactBan).map(contact => ({
          text: contact.name, details: contact.contactBanNote.trim() ? [contact.contactBanNote.trim()] : [], danger: true,
        }))),
      }]
    case 'emergency':
      return Array.from({ length: columnCount(rows, row => emergencyContacts(row).length) }, (_, index) => ({
        key: `emergency${index + 1}`, label: t.emergencyShort(index + 1), title: t.emergencyTitle(index + 1),
        cell: (row: ChildrenOverviewRowDto) => {
          const contact = emergencyContacts(row)[index]
          return lines(contact ? [person(contact, phoneLines(contact))] : [])
        },
      }))
    case 'phones':
      return Array.from({ length: columnCount(rows, row => phoneContacts(row).length) }, (_, index) => ({
        key: `contact${index + 1}`, label: t.contactShort(index + 1), title: t.contactTitle(index + 1),
        cell: (row: ChildrenOverviewRowDto) => {
          const contact = phoneContacts(row)[index]
          return lines(contact ? [person(contact, phoneLines(contact))] : [])
        },
      }))
    case 'lastMeeting':
      return [{ key, label: t.short.lastMeeting, title: t.lastMeetingTitle, cell: row => text(meetingText(lastMeeting(row), false)) }]
    case 'nextMeeting':
      return [{ key, label: t.short.nextMeeting, title: t.nextMeetingTitle, cell: row => text(meetingText(nextMeeting(row), true)) }]
    case 'allMeetings':
      return [{
        key, label: t.short.allMeetings, title: t.allMeetingsTitle,
        cell: row => lines(row.meetings.map(meeting => ({ text: `${shortDateText(meeting.date)} ${kindText(meeting)}`, details: [], danger: false }))),
      }]
    case 'meetingCount':
      return [{ key, label: t.short.meetingCount, title: t.meetingCountTitle, cell: row => text(String(row.meetings.length)) }]
  }
}

/**
 * The columns of a tab after the child's name, in the tab's order. The emergency and phone fields have one column per
 * contact, as many as the most of the given children have, both in call order (parents first, see `callOrder`). A
 * question the facility no longer has is left out.
 */
export function overviewColumns(
  columns: readonly OverviewColumnRef[], rows: ChildrenOverviewRowDto[], context: OverviewContext,
): OverviewColumn[] {
  const questions = new Map(context.questions.map(question => [question.id, question]))
  return columns.flatMap((column) => {
    if (column.type === 'field') return fieldColumns(column.key, rows, context)
    const question = questions.get(column.questionId)
    return question ? [consent(question)] : []
  })
}

/**
 * The tab to show: the one asked for (address), else the one this device showed last, else the first; null without
 * tabs. Ids that are not (or no longer) the facility's tabs are passed over.
 */
export function chosenSheet(sheets: readonly OverviewSheetDto[], requested: unknown, remembered: unknown): OverviewSheetDto | null {
  const find = (value: unknown) => {
    const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
    return sheets.find(sheet => sheet.id === id)
  }
  return find(requested) ?? find(remembered) ?? sheets[0] ?? null
}

/**
 * The print addresses before the tabs were the facility's named the fixed sheets (`/print/children/overview/privacy`):
 * each old key with a column typical of that sheet.
 */
const LEGACY_SHEETS: Record<string, DefaultColumnRef> = {
  privacy: { type: 'consent', builtinKey: 'artworkDisplay' }, messenger: { type: 'consent', builtinKey: 'whatsappContact' },
  health: { type: 'field', key: 'measlesProof' }, pickup: { type: 'field', key: 'pickUp' },
  guardians: { type: 'field', key: 'guardians' }, emergency: { type: 'field', key: 'emergency' },
  phones: { type: 'field', key: 'phones' }, meetings: { type: 'field', key: 'lastMeeting' },
}
export const isLegacySheetKey = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(LEGACY_SHEETS, value)

/** The facility's first tab with the typical column of an old sheet key (null: none has it, or no such key). */
export function legacySheet(
  sheets: readonly OverviewSheetDto[], questions: readonly ConsentQuestionDto[], key: string,
): OverviewSheetDto | null {
  if (!isLegacySheetKey(key)) return null
  const marker = LEGACY_SHEETS[key]!
  const matches = (column: OverviewColumnRef) => marker.type === 'field'
    ? column.type === 'field' && column.key === marker.key
    : column.type === 'consent' && questions.find(question => question.id === column.questionId)?.builtinKey === marker.builtinKey
  return sheets.find(sheet => sheet.columns.some(matches)) ?? null
}

export interface OverviewSection {
  key: string
  groupId: number | null
  /** The group's name, „ohne Gruppe“ for the children without group. */
  name: string
  rows: ChildrenOverviewRowDto[]
}

/**
 * The children by group in the order of the answer (groups' order, without group last). `groupFilter` as in the
 * child list: -1 = all groups, 0 = no group, otherwise the group id.
 */
export function overviewSections(dto: ChildrenOverviewDto, groupFilter: number): OverviewSection[] {
  return dto.groups
    .filter(group => groupFilter === -1 || (group.id ?? 0) === groupFilter)
    .map(group => ({
      key: String(group.id),
      groupId: group.id,
      name: group.id === null ? de.children.noGroup : group.name,
      rows: dto.children.filter(row => row.groupId === group.id),
    }))
    .filter(section => section.rows.length > 0)
}
