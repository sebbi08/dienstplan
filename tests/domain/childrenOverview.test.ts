import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONSENT_QUESTIONS, DEFAULT_OVERVIEW_SHEETS, type BuiltinConsentKey, type OverviewColumnRef,
} from '../../shared/domain/childConsents'
import type {
  ChildrenOverviewRowDto, ConsentAnswers, ConsentQuestionDto, OverviewContactDto, OverviewMeetingDto, OverviewSheetDto,
} from '../../shared/types/api'
import { de } from '../../app/locales/de'
import {
  chosenSheet, contactLabel, isLegacySheetKey, legacySheet, overviewColumns, overviewSections, triSymbol, type OverviewContext,
} from '../../app/utils/childrenOverview'

/** The default questions as a facility has them (ids 1–14). */
const QUESTIONS: ConsentQuestionDto[] = DEFAULT_CONSENT_QUESTIONS.map((question, index) => ({
  ...question, id: index + 1, sortOrder: index, hidden: false,
}))
const idOf = (key: BuiltinConsentKey) => QUESTIONS.find(question => question.builtinKey === key)!.id
const keyOf = (id: number) => QUESTIONS.find(question => question.id === id)!.builtinKey!
/** Answers by key, as the server sends them by question id. */
const consentsOf = (values: Partial<Record<BuiltinConsentKey, boolean>>): ConsentAnswers =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [idOf(key as BuiltinConsentKey), value]))

/** The default tabs by their former sheet key. */
const SHEET_INDEX = { privacy: 0, messenger: 1, health: 2, pickup: 3, guardians: 4, emergency: 5, phones: 6, meetings: 7 } as const
type Sheet = keyof typeof SHEET_INDEX
const sheetRefs = (sheet: Sheet): OverviewColumnRef[] => DEFAULT_OVERVIEW_SHEETS[SHEET_INDEX[sheet]]!.columns
  .map(column => column.type === 'field' ? column : { type: 'consent', questionId: idOf(column.builtinKey) })
const CONTEXT: OverviewContext = { questions: QUESTIONS, groups: [{ id: 4, name: 'Igel' }, { id: null, name: '' }] }
/** The columns of a default tab; a question's column key shown as its key (`q3` → `photosForeignPortfolios`). */
const columnsOf = (sheet: Sheet, rows: ChildrenOverviewRowDto[]) => overviewColumns(sheetRefs(sheet), rows, CONTEXT)
  .map(column => /^q\d+$/.test(column.key) ? { ...column, key: keyOf(Number(column.key.slice(1))) } : column)

const contact = (name: string, values: Partial<OverviewContactDto> = {}): OverviewContactDto => ({
  name, relation: '', phoneHome: '', phoneMobile: '', phoneWork: '', isGuardian: false, mayPickUp: false,
  contactBan: false, contactBanNote: '', emergencyRank: null, ...values,
})

const child = (values: Partial<ChildrenOverviewRowDto> = {}): ChildrenOverviewRowDto => ({
  id: 1, lastName: 'Muster', firstName: 'Mia', groupId: null, birthDate: '2022-03-15', address: '', school: '', consents: {},
  measlesProof: null, measlesProofDate: null, infectionBriefingDate: null, allergies: '', contacts: [], meetings: [], ...values,
})

const keys = (sheet: Sheet, rows: ChildrenOverviewRowDto[] = [child()]) => columnsOf(sheet, rows).map(column => column.key)

describe('children overview sheets', () => {
  it('starts every facility with the seven tabs of the Excel list in their order, then the parent meetings', () => {
    expect(DEFAULT_OVERVIEW_SHEETS.map(sheet => sheet.name)).toEqual([
      'Datenschutz', 'Messenger', 'Gesundheit', 'Abholberechtigte', 'Sorgeberechtigte', 'Anruf-Reihenfolge', 'Telefonnummern',
      'Elterngespräche',
    ])
  })

  it('opens the tab asked for, else the one shown last, else the first; none without tabs', () => {
    const sheets = [{ id: 7, name: 'A' }, { id: 9, name: 'B' }, { id: 12, name: 'C' }]
      .map((sheet, sortOrder) => ({ ...sheet, sortOrder, columns: [] })) as OverviewSheetDto[]
    expect(chosenSheet(sheets, '9', 12)?.id).toBe(9)
    expect(chosenSheet(sheets, undefined, 12)?.id).toBe(12)
    expect(chosenSheet(sheets, 'abc', '12')?.id).toBe(12)
    // A deleted tab (or one of another facility) falls back to the first.
    expect(chosenSheet(sheets, '99', 98)?.id).toBe(7)
    expect(chosenSheet([], '7', 7)).toBeNull()
  })

  it('leads an old print address (fixed sheet key) to the first tab with that sheet\'s typical column', () => {
    const sheets: OverviewSheetDto[] = DEFAULT_OVERVIEW_SHEETS.map((sheet, index) => ({
      id: 100 + index, name: sheet.name, sortOrder: index, columns: sheetRefs(Object.keys(SHEET_INDEX)[index] as Sheet),
    }))
    expect(Object.keys(SHEET_INDEX).map(key => legacySheet(sheets, QUESTIONS, key)?.id)).toEqual([100, 101, 102, 103, 104, 105, 106, 107])
    // A facility that moved the measles proof into its own tab, and one without any WhatsApp column.
    const own: OverviewSheetDto = { id: 7, name: 'Impfungen', sortOrder: -1, columns: [{ type: 'field', key: 'measlesProof' }] }
    expect(legacySheet([own, ...sheets], QUESTIONS, 'health')?.id).toBe(7)
    expect(legacySheet(sheets.filter(sheet => sheet.id !== 101), QUESTIONS, 'messenger')).toBeNull()
    expect(legacySheet(sheets, QUESTIONS, 'toString')).toBeNull()
    expect(isLegacySheetKey('phones')).toBe(true)
    expect(isLegacySheetKey('constructor')).toBe(false)
  })

  it('shows yes, no and open as ✓, ✗ and –', () => {
    expect([triSymbol(true), triSymbol(false), triSymbol(null)]).toEqual(['✓', '✗', '–'])
  })
})

describe('children overview columns', () => {
  it('lists the six privacy consents in the order of the spec, short label with the full text as title', () => {
    const columns = columnsOf('privacy', [child()])
    expect(columns.map(column => column.key)).toEqual([
      'artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosNamesBirthdaysDisplay', 'groupWorkWithNames',
    ])
    expect(columns[0]!.title).toBe('Bastel- und Malarbeiten aufhängen')
    for (const column of columns) expect(column.label.length).toBeLessThanOrEqual(column.title.length)
  })

  it('lists the messenger consents', () => {
    expect(keys('messenger')).toEqual(['whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup'])
  })

  it('shows the consents as yes, no or open', () => {
    const row = child({ consents: consentsOf({ whatsappContact: true, whatsappPhotos: false }) })
    expect(columnsOf('messenger', [row]).map(column => column.cell(row))).toEqual([
      { kind: 'tri', value: true, date: '' },
      { kind: 'tri', value: false, date: '' },
      { kind: 'tri', value: null, date: '' },
      { kind: 'tri', value: null, date: '' },
    ])
  })

  it('lists the health columns in order: measles with date, briefing date, allergies, the permissions and insect repellent', () => {
    const row = child({
      measlesProof: true, measlesProofDate: '2024-03-12', infectionBriefingDate: '2026-09-01', allergies: 'Erdnüsse\nKiwi',
      consents: consentsOf({ mayTakeTemperature: false, mayApplySunscreen: true, insectRepellent: false }),
    })
    const columns = columnsOf('health', [row])
    expect(columns.map(column => column.key)).toEqual([
      'measlesProof', 'infectionBriefingDate', 'allergies', 'mayTakeTemperature', 'mayApplySunscreen', 'mayApplyPlaster', 'insectRepellent',
    ])
    expect(columns.map(column => column.cell(row))).toEqual([
      { kind: 'tri', value: true, date: '12.03.2024' },
      { kind: 'text', text: '01.09.2026' },
      { kind: 'text', text: 'Erdnüsse\nKiwi' },
      { kind: 'tri', value: false, date: '' },
      { kind: 'tri', value: true, date: '' },
      { kind: 'tri', value: null, date: '' },
      { kind: 'tri', value: false, date: '' },
    ])
    expect(columns[6]!.title).toBe('Darf mit Insektenschutz eingesprüht werden')
  })

  it('leaves empty health fields empty', () => {
    const row = child()
    const [measles, briefing, allergies] = columnsOf('health', [row]).map(column => column.cell(row))
    expect(measles).toEqual({ kind: 'tri', value: null, date: '' })
    expect(briefing).toEqual({ kind: 'text', text: '' })
    expect(allergies).toEqual({ kind: 'text', text: '' })
  })

  it('names a contact with the relation in parentheses, without them when the relation is empty', () => {
    expect(contactLabel(contact('Erika Muster', { relation: 'Oma' }))).toBe('Erika Muster (Oma)')
    expect(contactLabel(contact('Erika Muster'))).toBe('Erika Muster')
  })

  it('lists who may pick up, never a contact with a contact ban', () => {
    const row = child({
      contacts: [
        contact('Erika Muster', { relation: 'Oma', mayPickUp: true }),
        contact('Max Muster', { relation: 'Vater', mayPickUp: true, contactBan: true, contactBanNote: 'Gericht' }),
        contact('Nora Nachbar', { mayPickUp: true }),
        contact('Tim Tante', { relation: 'Tante' }),
      ],
    })
    const columns = columnsOf('pickup', [row])
    expect(columns.map(column => column.key)).toEqual(['pickUp'])
    expect(columns[0]!.cell(row)).toEqual({
      kind: 'lines',
      lines: [
        { text: 'Erika Muster (Oma)', details: [], danger: false },
        { text: 'Nora Nachbar', details: [], danger: false },
      ],
    })
  })

  it('lists the guardians and the contact bans with their note in red', () => {
    const row = child({
      contacts: [
        contact('Anna Muster', { relation: 'Mutter', isGuardian: true }),
        contact('Max Muster', { relation: 'Vater', isGuardian: true, contactBan: true, contactBanNote: 'Beschluss Familiengericht' }),
        contact('Erika Muster', { relation: 'Oma' }),
      ],
    })
    const columns = columnsOf('guardians', [row])
    expect(columns.map(column => column.key)).toEqual(['guardians', 'contactBan'])
    expect(columns.map(column => column.cell(row))).toEqual([
      {
        kind: 'lines',
        lines: [
          { text: 'Anna Muster (Mutter)', details: [], danger: false },
          { text: 'Max Muster (Vater) – Kontaktverbot', details: [], danger: true },
        ],
      },
      { kind: 'lines', lines: [{ text: 'Max Muster', details: ['Beschluss Familiengericht'], danger: true }] },
    ])
  })

  it('shows the call order (parents first, then the others by number), one column each as many as the most a child has', () => {
    const first = child({
      contacts: [
        contact('Opa Otto', { relation: 'Opa', emergencyRank: 1, phoneMobile: '0171 2' }),
        contact('Max Muster', { relation: 'Vater', isGuardian: true }),
        contact('Anna Muster', { relation: 'Mutter', isGuardian: true, emergencyRank: 1, phoneHome: '0711 1', phoneWork: '0711 9' }),
        contact('Erika Muster', { relation: 'Oma' }),
      ],
    })
    const second = child({ id: 2, contacts: [contact('Paul Paten', { emergencyRank: 3 })] })
    const columns = columnsOf('emergency', [first, second])
    expect(columns.map(column => column.label)).toEqual(['1.', '2.', '3.'])
    expect(columns.map(column => column.cell(first))).toEqual([
      { kind: 'lines', lines: [{ text: 'Anna Muster (Mutter)', details: ['privat 0711 1', 'Arbeit 0711 9'], danger: false }] },
      { kind: 'lines', lines: [{ text: 'Max Muster (Vater)', details: [], danger: false }] },
      { kind: 'lines', lines: [{ text: 'Opa Otto (Opa)', details: ['mobil 0171 2'], danger: false }] },
    ])
    expect(columns.map(column => column.cell(second))).toEqual([
      { kind: 'lines', lines: [{ text: 'Paul Paten', details: [], danger: false }] },
      { kind: 'lines', lines: [] },
      { kind: 'lines', lines: [] },
    ])
  })

  it('shows the address and every contact in the order of the record with all phone numbers', () => {
    const row = child({
      address: 'Hauptstr. 1\n70173 Stuttgart',
      contacts: [
        contact('Anna Muster', { relation: 'Mutter', phoneHome: '0711 1', phoneMobile: '0171 1', phoneWork: '0711 9' }),
        contact('Max Muster', { relation: 'Vater' }),
      ],
    })
    const columns = columnsOf('phones', [row, child({ id: 2 })])
    expect(columns.map(column => column.key)).toEqual(['address', 'contact1', 'contact2'])
    expect(columns.map(column => column.cell(row))).toEqual([
      { kind: 'text', text: 'Hauptstr. 1\n70173 Stuttgart' },
      { kind: 'lines', lines: [{ text: 'Anna Muster (Mutter)', details: ['privat 0711 1', 'mobil 0171 1', 'Arbeit 0711 9'], danger: false }] },
      { kind: 'lines', lines: [{ text: 'Max Muster (Vater)', details: [], danger: false }] },
    ])
  })

  it('lists the contacts on the phone sheet in call order: parents first, then by number, then the record order', () => {
    const row = child({
      contacts: [
        contact('Nora Nachbar'),
        contact('Erika Muster', { relation: 'Oma', emergencyRank: 1 }),
        contact('Max Muster', { relation: 'Vater', isGuardian: true }),
        contact('Anna Muster', { relation: 'Mutter', isGuardian: true, emergencyRank: 1 }),
      ],
    })
    expect(columnsOf('phones', [row]).slice(1).map(column => column.cell(row))).toEqual(
      ['Anna Muster (Mutter)', 'Max Muster (Vater)', 'Erika Muster (Oma)', 'Nora Nachbar']
        .map(text => ({ kind: 'lines', lines: [{ text, details: [], danger: false }] })),
    )
  })

  it('marks a contact with a contact ban on the phone sheet in words and in red, phone numbers included, at the end', () => {
    const row = child({
      contacts: [
        contact('Max Muster', { relation: 'Vater', isGuardian: true, contactBan: true, phoneMobile: '0171 5' }),
        contact('Anna Muster', { relation: 'Mutter', phoneHome: '0711 1' }),
      ],
    })
    const columns = columnsOf('phones', [row])
    expect(columns.map(column => column.key)).toEqual(['address', 'contact1', 'contact2'])
    expect(columns.map(column => column.cell(row)).slice(1)).toEqual([
      { kind: 'lines', lines: [{ text: 'Anna Muster (Mutter)', details: ['privat 0711 1'], danger: false }] },
      { kind: 'lines', lines: [{ text: 'Max Muster (Vater) – Kontaktverbot', details: ['mobil 0171 5'], danger: true }] },
    ])
  })

  it('leaves a contact with a contact ban off the call order sheet', () => {
    const row = child({
      contacts: [
        contact('Max Muster', { relation: 'Vater', contactBan: true, emergencyRank: 1 }),
        contact('Erika Muster', { relation: 'Oma', emergencyRank: 2 }),
      ],
    })
    const columns = columnsOf('emergency', [row])
    expect(columns.map(column => column.cell(row))).toEqual([
      { kind: 'lines', lines: [{ text: 'Erika Muster (Oma)', details: [], danger: false }] },
    ])
  })

  it('keeps one contact column when no child has contacts, so the sheet still shows its rows', () => {
    expect(keys('emergency')).toEqual(['emergency1'])
    expect(keys('phones')).toEqual(['address', 'contact1'])
  })
})

describe('children overview columns from the facility\'s configuration', () => {
  it('shows birthday, group and future school as fields', () => {
    const row = child({ groupId: 4, birthDate: '2021-07-03', school: 'Grundschule am Park, Mannheim' })
    const columns = overviewColumns(
      [{ type: 'field', key: 'birthday' }, { type: 'field', key: 'group' }, { type: 'field', key: 'school' }], [row], CONTEXT,
    )
    expect(columns.map(column => [column.key, column.label, column.cell(row)])).toEqual([
      ['birthday', 'Geburtstag', { kind: 'text', text: '03.07.2021' }],
      ['group', 'Gruppe', { kind: 'text', text: 'Igel' }],
      ['school', 'Schule', { kind: 'text', text: 'Grundschule am Park, Mannheim' }],
    ])
    expect(columns[1]!.cell(child())).toEqual({ kind: 'text', text: de.children.noGroup })
  })

  it('takes a question\'s current short name and text, in the tab\'s order, and leaves out one the facility no longer has', () => {
    const own: ConsentQuestionDto = { id: 50, text: 'Darf schwimmen gehen', short: 'Schwimmen', area: 'Ausflüge', sortOrder: 20, hidden: true, builtinKey: null }
    const row = child({ consents: { 50: true } })
    const columns = overviewColumns(
      [{ type: 'consent', questionId: 50 }, { type: 'consent', questionId: 99 }, { type: 'field', key: 'allergies' }],
      [row], { ...CONTEXT, questions: [...QUESTIONS, own] },
    )
    expect(columns.map(column => [column.key, column.label, column.title])).toEqual([
      ['q50', 'Schwimmen', 'Darf schwimmen gehen'], ['allergies', 'Allergien', 'Allergien und Unverträglichkeiten'],
    ])
    expect(columns[0]!.cell(row)).toEqual({ kind: 'tri', value: true, date: '' })
    expect(columns[0]!.cell(child())).toEqual({ kind: 'tri', value: null, date: '' })
  })
})

describe('children overview parent meetings', () => {
  const meeting = (date: string, start: number, kind: OverviewMeetingDto['kind'], planned = false): OverviewMeetingDto =>
    ({ date, start, kind, planned })

  it('has the columns last meeting, next planned, all meetings and count', () => {
    const columns = columnsOf('meetings', [child()])
    expect(columns.map(column => column.key)).toEqual(['lastMeeting', 'nextMeeting', 'allMeetings', 'meetingCount'])
    expect(columns.map(column => column.label)).toEqual(['Letztes Gespräch', 'Nächstes geplant', 'Alle Gespräche', 'Anzahl'])
  })

  it('shows the latest held meeting, the nearest planned one with its time, all meetings newest first and their count', () => {
    // Newest first, as the server sends them: two planned ones ahead, then the held ones.
    const row = child({
      meetings: [
        meeting('2027-03-04', 600, 'final', true),
        meeting('2026-11-02', 14 * 60 + 30, 'development', true),
        meeting('2026-10-01', 540, 'settling_in'),
        meeting('2025-09-15', 480, 'other'),
      ],
    })
    expect(columnsOf('meetings', [row]).map(column => column.cell(row))).toEqual([
      { kind: 'text', text: '01.10.2026 Eingewöhnung' },
      { kind: 'text', text: '02.11.2026 14:30 Entwicklungsgespräch' },
      {
        kind: 'lines',
        lines: [
          { text: '04.03.27 Abschlussgespräch', details: [], danger: false },
          { text: '02.11.26 Entwicklungsgespräch', details: [], danger: false },
          { text: '01.10.26 Eingewöhnung', details: [], danger: false },
          { text: '15.09.25 Sonstiges', details: [], danger: false },
        ],
      },
      { kind: 'text', text: '4' },
    ])
  })

  it('leaves last and next empty without such a meeting, and counts zero without any', () => {
    const plannedOnly = child({ meetings: [meeting('2026-12-01', 9 * 60, 'development', true)] })
    const heldOnly = child({ id: 2, meetings: [meeting('2026-10-01', 9 * 60, 'other')] })
    const none = child({ id: 3 })
    const columns = columnsOf('meetings', [plannedOnly, heldOnly, none])
    const [last, next] = columns
    expect(last!.cell(plannedOnly)).toEqual({ kind: 'text', text: '' })
    expect(next!.cell(plannedOnly)).toEqual({ kind: 'text', text: '01.12.2026 9:00 Entwicklungsgespräch' })
    expect(next!.cell(heldOnly)).toEqual({ kind: 'text', text: '' })
    expect(columns.map(column => column.cell(none))).toEqual([
      { kind: 'text', text: '' }, { kind: 'text', text: '' }, { kind: 'lines', lines: [] }, { kind: 'text', text: '0' },
    ])
  })
})

describe('children overview sections', () => {
  const dto = {
    groups: [{ id: 4, name: 'Igel' }, { id: null, name: '' }],
    children: [child({ id: 1, groupId: 4 }), child({ id: 2, groupId: 4 }), child({ id: 3, groupId: null })],
  }

  it('groups the children by the listed groups, without group last as „ohne Gruppe“', () => {
    expect(overviewSections(dto, -1).map(section => [section.name, section.rows.map(row => row.id)])).toEqual([
      ['Igel', [1, 2]], [de.children.noGroup, [3]],
    ])
  })

  it('filters like the list: a group id, or 0 for the children without group', () => {
    expect(overviewSections(dto, 4).map(section => section.rows.map(row => row.id))).toEqual([[1, 2]])
    expect(overviewSections(dto, 0).map(section => section.rows.map(row => row.id))).toEqual([[3]])
  })
})
