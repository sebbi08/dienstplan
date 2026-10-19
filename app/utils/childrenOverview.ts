// The columns of the Excel-like overview tables ("Übersicht" under "Kinder"). The texts are imported relative so a
// test can load this file.
import { parseIsoDate } from '#shared/domain/dates'
import type { ChildrenOverviewDto, ChildrenOverviewRowDto, ConsentKey, OverviewContactDto, TriState } from '#shared/types/api'
import { de } from '../locales/de'

/** The sub-tabs, in the order of the sheets of the Excel list. */
export const OVERVIEW_SHEETS = ['privacy', 'messenger', 'health', 'pickup', 'guardians', 'emergency', 'phones'] as const
export type OverviewSheet = typeof OVERVIEW_SHEETS[number]
export const isOverviewSheet = (value: unknown): value is OverviewSheet => (OVERVIEW_SHEETS as readonly unknown[]).includes(value)

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

/** "Erika Muster (Oma)", without the parentheses when the relation is empty. */
export const contactLabel = (contact: Pick<OverviewContactDto, 'name' | 'relation'>): string =>
  contact.relation.trim() ? `${contact.name} (${contact.relation.trim()})` : contact.name

/** The filled-in phone numbers: "privat …", "mobil …", "Arbeit …". */
const phoneLines = (contact: OverviewContactDto): string[] => [
  [t.phoneHome, contact.phoneHome], [t.phoneMobile, contact.phoneMobile], [t.phoneWork, contact.phoneWork],
].filter(([, number]) => number!.trim() !== '').map(([label, number]) => `${label} ${number!.trim()}`)

const person = (contact: OverviewContactDto, details: string[] = []): OverviewLine => ({ text: contactLabel(contact), details, danger: false })
const lines = (list: OverviewLine[]): OverviewCell => ({ kind: 'lines', lines: list })
const tri = (value: TriState, date = ''): OverviewCell => ({ kind: 'tri', value, date })
const text = (value: string): OverviewCell => ({ kind: 'text', text: value })

const consent = (key: ConsentKey): OverviewColumn => ({
  key, label: t.short[key], title: de.children.consents[key], cell: row => tri(row.consents[key]),
})

/** The emergency contacts in their order (rank ascending; the record's order for equal ranks). */
const emergencyContacts = (row: ChildrenOverviewRowDto): OverviewContactDto[] =>
  row.contacts.filter(contact => contact.emergencyRank !== null).sort((a, b) => a.emergencyRank! - b.emergencyRank!)

/** As many columns as the most a child has, at least one (so the sheet still shows its rows). */
const columnCount = (rows: ChildrenOverviewRowDto[], count: (row: ChildrenOverviewRowDto) => number): number =>
  Math.max(1, ...rows.map(count))

/**
 * The columns of a sheet after the child's name, in the order of the spec. The emergency and phone sheets have one
 * column per contact, as many as the most of the given children have.
 */
export function overviewColumns(sheet: OverviewSheet, rows: ChildrenOverviewRowDto[]): OverviewColumn[] {
  switch (sheet) {
    case 'privacy':
      return (['artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosNamesBirthdaysDisplay', 'groupWorkWithNames'] as const)
        .map(consent)
    case 'messenger':
      return (['whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup'] as const).map(consent)
    case 'health':
      return [
        { key: 'measlesProof', label: t.short.measlesProof, title: t.measlesTitle, cell: row => tri(row.measlesProof, dateText(row.measlesProofDate)) },
        { key: 'infectionBriefingDate', label: t.short.infectionBriefingDate, title: t.infectionBriefingTitle, cell: row => text(dateText(row.infectionBriefingDate)) },
        { key: 'allergies', label: t.short.allergies, title: de.children.fields.allergiesText, cell: row => text(row.allergies), wide: true },
        { key: 'mayTakeTemperature', label: t.short.mayTakeTemperature, title: de.children.fields.mayTakeTemperature, cell: row => tri(row.mayTakeTemperature) },
        { key: 'mayApplySunscreen', label: t.short.mayApplySunscreen, title: de.children.fields.mayApplySunscreen, cell: row => tri(row.mayApplySunscreen) },
        { key: 'mayApplyPlaster', label: t.short.mayApplyPlaster, title: de.children.fields.mayApplyPlaster, cell: row => tri(row.mayApplyPlaster) },
        consent('insectRepellent'),
      ]
    case 'pickup':
      return [{
        key: 'pickUp', label: t.short.pickUp, title: t.pickUpTitle,
        cell: row => lines(row.contacts.filter(contact => contact.mayPickUp && !contact.contactBan).map(contact => person(contact))),
      }]
    case 'guardians':
      return [
        { key: 'guardians', label: t.short.guardians, title: t.guardiansTitle, cell: row => lines(row.contacts.filter(contact => contact.isGuardian).map(contact => person(contact))) },
        {
          key: 'contactBan', label: t.short.contactBan, title: t.contactBanTitle,
          cell: row => lines(row.contacts.filter(contact => contact.contactBan).map(contact => ({
            text: contact.name, details: contact.contactBanNote.trim() ? [contact.contactBanNote.trim()] : [], danger: true,
          }))),
        },
      ]
    case 'emergency':
      return Array.from({ length: columnCount(rows, row => emergencyContacts(row).length) }, (_, index) => ({
        key: `emergency${index + 1}`, label: t.emergencyShort(index + 1), title: t.emergencyTitle(index + 1),
        cell: (row: ChildrenOverviewRowDto) => {
          const contact = emergencyContacts(row)[index]
          return lines(contact ? [person(contact, phoneLines(contact))] : [])
        },
      }))
    case 'phones':
      return [
        { key: 'address', label: t.short.address, title: de.children.fields.address, cell: row => text(row.address), wide: true },
        ...Array.from({ length: columnCount(rows, row => row.contacts.length) }, (_, index) => ({
          key: `contact${index + 1}`, label: t.contactShort(index + 1), title: t.contactTitle(index + 1),
          cell: (row: ChildrenOverviewRowDto) => {
            const contact = row.contacts[index]
            return lines(contact ? [person(contact, phoneLines(contact))] : [])
          },
        })),
      ]
  }
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
