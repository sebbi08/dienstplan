import { describe, expect, it } from 'vitest'
import {
  CONSENT_KEYS, type ChildConsents, type ChildrenOverviewRowDto, type OverviewContactDto, type OverviewMeetingDto,
} from '../../shared/types/api'
import { de } from '../../app/locales/de'
import {
  OVERVIEW_SHEETS, contactLabel, isOverviewSheet, overviewColumns, overviewSections, triSymbol,
} from '../../app/utils/childrenOverview'

const openConsents = Object.fromEntries(CONSENT_KEYS.map(key => [key, null])) as ChildConsents

const contact = (name: string, values: Partial<OverviewContactDto> = {}): OverviewContactDto => ({
  name, relation: '', phoneHome: '', phoneMobile: '', phoneWork: '', isGuardian: false, mayPickUp: false,
  contactBan: false, contactBanNote: '', emergencyRank: null, ...values,
})

const child = (values: Partial<ChildrenOverviewRowDto> = {}): ChildrenOverviewRowDto => ({
  id: 1, lastName: 'Muster', firstName: 'Mia', groupId: null, address: '', consents: openConsents,
  measlesProof: null, measlesProofDate: null, infectionBriefingDate: null, allergies: '',
  mayTakeTemperature: null, mayApplySunscreen: null, mayApplyPlaster: null, contacts: [], meetings: [], ...values,
})

const keys = (sheet: typeof OVERVIEW_SHEETS[number], rows: ChildrenOverviewRowDto[] = [child()]) =>
  overviewColumns(sheet, rows).map(column => column.key)

describe('children overview sheets', () => {
  it('has the seven sheets of the Excel list in their order, then the parent meetings, with their labels', () => {
    expect(OVERVIEW_SHEETS).toEqual(['privacy', 'messenger', 'health', 'pickup', 'guardians', 'emergency', 'phones', 'meetings'])
    expect(OVERVIEW_SHEETS.map(sheet => de.children.overview.sheets[sheet])).toEqual([
      'Datenschutz', 'Messenger', 'Gesundheit', 'Abholberechtigte', 'Sorgeberechtigte', 'Notfallkontakte', 'Telefonnummern',
      'Elterngespräche',
    ])
    expect(isOverviewSheet('meetings')).toBe(true)
    expect(isOverviewSheet('phones')).toBe(true)
    expect(isOverviewSheet('archive')).toBe(false)
  })

  it('shows yes, no and open as ✓, ✗ and –', () => {
    expect([triSymbol(true), triSymbol(false), triSymbol(null)]).toEqual(['✓', '✗', '–'])
  })
})

describe('children overview columns', () => {
  it('lists the six privacy consents in the order of the spec, short label with the full text as title', () => {
    const columns = overviewColumns('privacy', [child()])
    expect(columns.map(column => column.key)).toEqual([
      'artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosNamesBirthdaysDisplay', 'groupWorkWithNames',
    ])
    expect(columns[0]!.title).toBe(de.children.consents.artworkDisplay)
    for (const column of columns) expect(column.label.length).toBeLessThanOrEqual(column.title.length)
  })

  it('lists the messenger consents', () => {
    expect(keys('messenger')).toEqual(['whatsappContact', 'whatsappPhotos', 'signalPhotos', 'whatsappParentGroup'])
  })

  it('shows the consents as yes, no or open', () => {
    const row = child({ consents: { ...openConsents, whatsappContact: true, whatsappPhotos: false } })
    expect(overviewColumns('messenger', [row]).map(column => column.cell(row))).toEqual([
      { kind: 'tri', value: true, date: '' },
      { kind: 'tri', value: false, date: '' },
      { kind: 'tri', value: null, date: '' },
      { kind: 'tri', value: null, date: '' },
    ])
  })

  it('lists the health columns in order: measles with date, briefing date, allergies, the permissions and insect repellent', () => {
    const row = child({
      measlesProof: true, measlesProofDate: '2024-03-12', infectionBriefingDate: '2026-09-01', allergies: 'Erdnüsse\nKiwi',
      mayTakeTemperature: false, mayApplySunscreen: true, consents: { ...openConsents, insectRepellent: false },
    })
    const columns = overviewColumns('health', [row])
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
    expect(columns[6]!.title).toBe(de.children.consents.insectRepellent)
  })

  it('leaves empty health fields empty', () => {
    const row = child()
    const [measles, briefing, allergies] = overviewColumns('health', [row]).map(column => column.cell(row))
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
    const columns = overviewColumns('pickup', [row])
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
    const columns = overviewColumns('guardians', [row])
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

  it('shows the emergency contacts sorted by their rank, one column each as many as the most a child has', () => {
    const first = child({
      contacts: [
        contact('Opa Otto', { relation: 'Opa', emergencyRank: 2, phoneMobile: '0171 2' }),
        contact('Anna Muster', { relation: 'Mutter', emergencyRank: 1, phoneHome: '0711 1', phoneWork: '0711 9' }),
        contact('Erika Muster', { relation: 'Oma' }),
      ],
    })
    const second = child({ id: 2, contacts: [contact('Paul Paten', { emergencyRank: 3 })] })
    const columns = overviewColumns('emergency', [first, second])
    expect(columns.map(column => column.label)).toEqual(['1.', '2.'])
    expect(columns.map(column => column.cell(first))).toEqual([
      { kind: 'lines', lines: [{ text: 'Anna Muster (Mutter)', details: ['privat 0711 1', 'Arbeit 0711 9'], danger: false }] },
      { kind: 'lines', lines: [{ text: 'Opa Otto (Opa)', details: ['mobil 0171 2'], danger: false }] },
    ])
    expect(columns.map(column => column.cell(second))).toEqual([
      { kind: 'lines', lines: [{ text: 'Paul Paten', details: [], danger: false }] },
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
    const columns = overviewColumns('phones', [row, child({ id: 2 })])
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
    expect(overviewColumns('phones', [row]).slice(1).map(column => column.cell(row))).toEqual(
      ['Anna Muster (Mutter)', 'Max Muster (Vater)', 'Erika Muster (Oma)', 'Nora Nachbar']
        .map(text => ({ kind: 'lines', lines: [{ text, details: [], danger: false }] })),
    )
  })

  it('leaves a contact with a contact ban off the phone sheet, also in the column count', () => {
    const row = child({
      contacts: [
        contact('Max Muster', { relation: 'Vater', isGuardian: true, contactBan: true, phoneMobile: '0171 5' }),
        contact('Anna Muster', { relation: 'Mutter', phoneHome: '0711 1' }),
      ],
    })
    const columns = overviewColumns('phones', [row])
    expect(columns.map(column => column.key)).toEqual(['address', 'contact1'])
    expect(columns[1]!.cell(row)).toEqual(
      { kind: 'lines', lines: [{ text: 'Anna Muster (Mutter)', details: ['privat 0711 1'], danger: false }] },
    )
  })

  it('marks a contact with a contact ban in an emergency column too', () => {
    const row = child({ contacts: [contact('Max Muster', { relation: 'Vater', contactBan: true, emergencyRank: 1 })] })
    expect(overviewColumns('emergency', [row])[0]!.cell(row)).toEqual({
      kind: 'lines', lines: [{ text: 'Max Muster (Vater) – Kontaktverbot', details: [], danger: true }],
    })
  })

  it('keeps one contact column when no child has contacts, so the sheet still shows its rows', () => {
    expect(keys('emergency')).toEqual(['emergency1'])
    expect(keys('phones')).toEqual(['address', 'contact1'])
  })
})

describe('children overview parent meetings', () => {
  const meeting = (date: string, start: number, kind: OverviewMeetingDto['kind'], planned = false): OverviewMeetingDto =>
    ({ date, start, kind, planned })

  it('has the columns last meeting, next planned, all meetings and count', () => {
    const columns = overviewColumns('meetings', [child()])
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
    expect(overviewColumns('meetings', [row]).map(column => column.cell(row))).toEqual([
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
    const columns = overviewColumns('meetings', [plannedOnly, heldOnly, none])
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
