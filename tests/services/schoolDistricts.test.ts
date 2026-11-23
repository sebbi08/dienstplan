import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { children, schoolDistrictLists, schoolDistrictRows } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { pdfTextItems } from '../../server/lib/pdfText'
import { adoptDistrictSchool, createChild, getChild, updateChildMaster } from '../../server/services/children'
import { createContact, deleteContact, listContacts } from '../../server/services/contacts'
import { upcomingSchoolChildren } from '../../server/services/occupancy'
import {
  deleteSchoolDistrictList, globalSchoolOptions, parseSchoolDistrictFile, saveSchoolDistrictList, schoolDistrictMatcher,
  schoolDistrictSettings,
} from '../../server/services/schoolDistricts'
import type { DistrictRow } from '../../shared/domain/schoolDistricts'
import type { ChildMasterInput, ContactInput, Role, SchoolDistrictListInput } from '../../shared/types/api'
import { addFacility, addUser, asChildViewer, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'
import { streetListPdf, textPdf } from '../helpers/textPdf'

const NOW = new Date('2027-04-01T09:00:00.000Z')
const TODAY = '2027-04-01'

const row = (street: string, from: number | null, to: number | null, district: string, extra: Partial<DistrictRow> = {}): DistrictRow => ({
  street, fromNo: from, fromSuffix: '', toNo: to, toSuffix: '',
  side: from === null || to === null ? 'all' : from % 2 === to % 2 ? (from % 2 === 1 ? 'odd' : 'even') : 'all',
  district, flags: [], note: '', ...extra,
})

const list = (rows: DistrictRow[], districts: SchoolDistrictListInput['districts'] = [], name = 'Stadt'): SchoolDistrictListInput =>
  ({ name, asOf: '2021', rows, districts })

const contact = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  organisation: 'Südstadtschule', person: '', role: '', phone: '', mobile: '', email: '', street: '', postalCode: '', city: '',
  website: '', note: '', visibleToStaff: false, ...overrides,
})

/** The quirky lines of the real list (see tests/domain/schoolDistricts.test.ts), as PDF columns. */
const LINES = [
  ['Schulbezirke', 'Hausnummer', 'Schulbezirke'],
  ['Ahornweg', '2- 14', '04'],
  ['Bahnhofanlage', '1- 3 A', '02'],
  ['Erfurter Straße', '4 - 20', '03'],
  ['Carl-Benz-Straße', '1- 23 1', '01'],
  ['Markgrafenstraße', '22 - 14', '02'],
  ['Clementine-Bassermann-St', '1- 27', '02'],
  ['Friedrich-Ebert-Straße', '2- 84', '01'],
  ['Friedrich-Ebert-Straße', '22- 82', '03'],
  ['1 Zeyherschule'], ['2 Südstadtschule'], ['3 Nordstadtschule'], ['4 Hirschackerschule'],
]

describe('school district lists (Schulbezirke)', () => {
  let db: Db
  const as = (role: Role, facilityId = 1, id = 1) => ({ id, role, permissions: permissionsOf(role), facilityId })
  const provider = as('provider')
  const leitung = as('admin', 1, 2)
  const schoolsCategory = (facilityId = 1) => listContacts(db, as('admin', facilityId)).categories.find(category => category.name === 'Schulen')!.id
  const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
    lastName: 'Meier', firstName: 'Lena', birthDate: '2021-03-15', address: '', groupId: null, careTypeId: null,
    entryDate: '2024-09-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
    schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null, ...overrides,
  })

  beforeEach(() => {
    db = createTestDb()
    addUser(db, 'traeger', 'provider')
    addUser(db, 'leitung', 'admin')
  })

  describe('reading uploads', () => {
    it('reads the PDF text layer in a worker: rows, flags and the legend', async () => {
      const parsed = await parseSchoolDistrictFile({ data: streetListPdf(LINES), filename: 'schulbezirke-2021.pdf' })
      expect(parsed).toMatchObject({ name: 'schulbezirke-2021', asOf: '2021', skippedCount: 0, truncated: false })
      expect(parsed.rows.map(entry => [entry.street, entry.fromNo, entry.fromSuffix, entry.toNo, entry.toSuffix, entry.side, entry.district, entry.flags])).toEqual([
        ['Ahornweg', 2, '', 14, '', 'even', '04', []],
        ['Bahnhofanlage', 1, '', 3, 'a', 'odd', '02', []],
        ['Erfurter Straße', 4, '', 20, '', 'even', '03', []],
        ['Carl-Benz-Straße', 1, '', 23, '', 'odd', '01', ['unclear']],
        ['Markgrafenstraße', 14, '', 22, '', 'even', '02', ['reversed']],
        ['Clementine-Bassermann-St', 1, '', 27, '', 'odd', '02', []],
        ['Friedrich-Ebert-Straße', 2, '', 84, '', 'even', '01', []],
        ['Friedrich-Ebert-Straße', 22, '', 82, '', 'even', '03', []],
      ])
      expect(parsed.legend.map(entry => entry.name)).toEqual(['Zeyherschule', 'Südstadtschule', 'Nordstadtschule', 'Hirschackerschule'])
    }, 30_000)

    it('reads CSV in UTF-8 and Windows-1252', async () => {
      const utf8 = await parseSchoolDistrictFile({ data: Buffer.from('Straße;Hausnummer;Bezirk\nMühlweg;1-9;2\n', 'utf8'), filename: 'liste.csv' })
      expect(utf8.rows).toEqual([row('Mühlweg', 1, 9, '02')])
      const ansi = await parseSchoolDistrictFile({ data: Buffer.from('Straße,Hausnummer,Bezirk\r\nMühlweg,1-9,2\r\n', 'latin1'), filename: 'LISTE.CSV' })
      expect(ansi.rows).toEqual([row('Mühlweg', 1, 9, '02')])
    })

    it('refuses other files, empty results, scans and broken PDFs', async () => {
      const code = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error as ServiceError).code)
      // An Excel file (a zip) is no CSV: save it as CSV first.
      expect(await code(parseSchoolDistrictFile({ data: Buffer.from('PK\u0003\u0004xl/workbook.xml'), filename: 'liste.xlsx' }))).toBe('school_district_file_type')
      expect(await code(parseSchoolDistrictFile({ data: Buffer.from('nur Text ohne Zeilen'), filename: 'liste.csv' }))).toBe('school_district_no_rows')
      expect(await code(parseSchoolDistrictFile({ data: Buffer.alloc(10 * 1024 * 1024 + 1), filename: 'gross.csv' }))).toBe('document_too_large')
      expect(await code(parseSchoolDistrictFile({ data: textPdf([[]]), filename: 'scan.pdf' }))).toBe('pdf_no_text')
      expect(await code(parseSchoolDistrictFile({ data: Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> garbage'), filename: 'kaputt.pdf' }))).toBe('pdf_unreadable')
    }, 30_000)

    it('stops a PDF that takes too long or has too many pages, without blocking the server', async () => {
      const pdf = streetListPdf(LINES, 2)
      await expect(pdfTextItems(pdf, { timeoutMs: 1, maxPages: 100, maxItems: 1000, heapMb: 64 })).rejects.toMatchObject({ code: 'pdf_unreadable', details: { reason: 'time' } })
      await expect(pdfTextItems(pdf, { timeoutMs: 20_000, maxPages: 2, maxItems: 1000, heapMb: 64 })).rejects.toMatchObject({ code: 'pdf_unreadable', details: { reason: 'pages' } })
      await expect(pdfTextItems(pdf, { timeoutMs: 20_000, maxPages: 100, maxItems: 5, heapMb: 64 })).rejects.toMatchObject({ code: 'pdf_unreadable', details: { reason: 'items' } })
    }, 60_000)
  })

  describe('saving', () => {
    it('saves, replaces and deletes the facility’s list, keeping who created it', () => {
      const sued = createContact(db, leitung, contact({ categoryId: schoolsCategory(), city: 'Musterstadt' }), NOW)
      saveSchoolDistrictList(db, leitung, 1, list(
        [row(' Ahornweg ', 2, 14, '4'), row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'A', side: 'odd', flags: ['unclear'], note: ' Quelle ' })],
        [{ code: '02', name: ' Südstadtschule ', contactId: sued }, { code: '07', name: 'unbenutzt', contactId: null }],
      ), NOW)
      const settings = schoolDistrictSettings(db, 1)
      expect(settings.own).toEqual({
        scope: 'facility', name: 'Stadt', asOf: '2021',
        rows: [row('Ahornweg', 2, 14, '04'), row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd', flags: ['unclear'], note: 'Quelle' })],
        // Every code the rows use, unused ones dropped.
        districts: [
          { code: '02', name: 'Südstadtschule', contactId: sued, contactName: 'Südstadtschule, Musterstadt' },
          { code: '04', name: '', contactId: null, contactName: null },
        ],
        updatedAt: NOW.toISOString(), updatedBy: 'leitung',
      })
      expect(settings.global).toBeNull()
      expect(settings.schoolOptions).toEqual([{ id: sued, name: 'Südstadtschule, Musterstadt' }])
      expect(db.select().from(schoolDistrictRows).all().map(entry => entry.streetKey)).toEqual(['ahornweg', 'bahnhofanlage'])

      const later = new Date('2027-05-01T09:00:00.000Z')
      saveSchoolDistrictList(db, provider, 1, list([row('Zeyherstraße', 1, 3, '02')], [], 'Neu'), later)
      const stored = db.select().from(schoolDistrictLists).all()
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({ facilityId: 1, name: 'Neu', createdBy: 2, createdAt: NOW.toISOString(), updatedBy: 1, updatedAt: later.toISOString() })
      expect(schoolDistrictSettings(db, 1).own!.rows).toEqual([row('Zeyherstraße', 1, 3, '02')])
      expect(db.select().from(schoolDistrictRows).all()).toHaveLength(1)

      deleteSchoolDistrictList(db, 1)
      expect(schoolDistrictSettings(db, 1).own).toBeNull()
      expect(db.select().from(schoolDistrictRows).all()).toHaveLength(0)
    })

    it('saves large lists in chunks', () => {
      const rows = Array.from({ length: 1500 }, (_, index) => row(`Weg ${index}`, 1, 9, '01'))
      saveSchoolDistrictList(db, leitung, 1, list(rows), NOW)
      expect(schoolDistrictSettings(db, 1).own!.rows).toHaveLength(1500)
    })

    it('refuses rows that make no sense, with the row’s number', () => {
      const failing = (bad: DistrictRow) => {
        try {
          saveSchoolDistrictList(db, leitung, 1, list([row('Ahornweg', 2, 14, '04'), bad]), NOW)
          return null
        }
        catch (error) {
          return { code: (error as ServiceError).code, details: (error as ServiceError).details }
        }
      }
      for (const bad of [
        row('  ', 1, 3, '01'), row('Weg', 1, 3, ' '), row('Weg', 5, 3, '01'), row('Weg', 1, null, '01'),
        row('Weg', 1, 3, '01', { toSuffix: 'ab' }), row('Weg', 3, 3, '01', { fromSuffix: 'b', toSuffix: 'a' }),
        row('Weg', null, null, '01', { fromSuffix: 'a' }),
      ]) expect(failing(bad), bad.street).toEqual({ code: 'school_district_row_invalid', details: { row: 2 } })
      expect(errorCode(() => saveSchoolDistrictList(db, leitung, 1, list([]), NOW))).toBe('school_district_no_rows')
    })

    it('maps districts only to schools of the list’s scope', () => {
      const krippe = addFacility(db, 'Krippe')
      const own = createContact(db, leitung, contact({ categoryId: schoolsCategory() }), NOW)
      const foreign = createContact(db, as('admin', krippe), contact({ categoryId: schoolsCategory(krippe), organisation: 'Krippenschule' }), NOW)
      const amt = createContact(db, leitung, contact({ categoryId: listContacts(db, leitung).categories.find(c => c.name === 'Jugendamt')!.id, organisation: 'Amt' }), NOW)
      const global = createContact(db, provider, contact({ scope: 'all', categoryName: 'Grundschulen', organisation: 'Waldschule' }), NOW)
      const rows = [row('Ahornweg', 2, 14, '04')]
      for (const contactId of [foreign, amt]) {
        expect(errorCode(() => saveSchoolDistrictList(db, leitung, 1, list(rows, [{ code: '04', name: '', contactId }]), NOW))).toBe('school_district_contact_invalid')
      }
      // The facility's list takes its own schools and the Träger's; the Träger's list only the Träger's.
      saveSchoolDistrictList(db, leitung, 1, list(rows, [{ code: '04', name: '', contactId: own }]), NOW)
      saveSchoolDistrictList(db, leitung, 1, list(rows, [{ code: '04', name: '', contactId: global }]), NOW)
      expect(globalSchoolOptions(db)).toEqual([{ id: global, name: 'Waldschule' }])
      expect(errorCode(() => saveSchoolDistrictList(db, provider, null, list(rows, [{ code: '04', name: '', contactId: own }]), NOW))).toBe('school_district_contact_invalid')
      saveSchoolDistrictList(db, provider, null, list(rows, [{ code: '04', name: 'Waldschule', contactId: global }]), NOW)
      expect(schoolDistrictSettings(db, 1).global).toMatchObject({ scope: 'global', districts: [{ code: '04', contactId: global }] })
      // A school deleted from the address book leaves the district without it.
      deleteContact(db, provider, global)
      expect(schoolDistrictSettings(db, 1).global!.districts[0]).toMatchObject({ contactId: null, contactName: null })
    })
  })

  describe('matching children', () => {
    const editor = () => asChildViewer(addUser(db, 'leitung2', 'admin'))

    it('shows the district in the record, computed on read, with „Übernehmen“ while no school is chosen', () => {
      const actor = editor()
      const sued = createContact(db, leitung, contact({ categoryId: schoolsCategory() }), NOW)
      saveSchoolDistrictList(db, leitung, 1, list(
        [row('Bahnhofanlage', 1, 3, '02', { toSuffix: 'a', side: 'odd' }), row('Friedrich-Ebert-Straße', 2, 84, '01'), row('Friedrich-Ebert-Straße', 22, 82, '03')],
        [{ code: '02', name: 'Südstadtschule', contactId: sued }],
      ), NOW)
      const id = createChild(db, actor, 1, master({ address: 'Bahnhofanlage 3a\n68723 Musterstadt' }), NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toEqual({
        status: 'match', code: '02', name: 'Südstadtschule', asOf: '2021', scope: 'facility', contactId: sued,
        contactName: 'Südstadtschule', canAdopt: true,
      })
      adoptDistrictSchool(db, actor, 1, id, sued, TODAY, NOW)
      const record = getChild(db, actor, id, TODAY)
      expect(record).toMatchObject({ master: { futureSchoolContactId: sued }, futureSchoolName: 'Südstadtschule', stamps: { master: { updatedBy: 'leitung2' } } })
      expect(record.districtMatch).toMatchObject({ status: 'match', canAdopt: false })
      expect(errorCode(() => adoptDistrictSchool(db, actor, 1, id, sued, TODAY, NOW))).toBe('future_school_already_set')

      // Address changed: computed again; overlapping rows are ambiguous, an unknown street is none, no address nothing.
      updateChildMaster(db, actor, 1, id, master({ address: 'Friedrich-Ebert-Str. 30', futureSchoolContactId: null }), TODAY, NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toEqual({ status: 'ambiguous', codes: ['01', '03'], asOf: '2021', scope: 'facility' })
      expect(errorCode(() => adoptDistrictSchool(db, actor, 1, id, sued, TODAY, NOW))).toBe('school_district_changed')
      updateChildMaster(db, actor, 1, id, master({ address: 'Gibtsnichtweg 1' }), TODAY, NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toEqual({ status: 'none', asOf: '2021', scope: 'facility' })
      updateChildMaster(db, actor, 1, id, master({ address: '' }), TODAY, NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toBeNull()
      // A district without a school: shown, nothing to take over.
      updateChildMaster(db, actor, 1, id, master({ address: 'Friedrich-Ebert-Straße 10' }), TODAY, NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toMatchObject({ status: 'match', code: '01', name: '', contactId: null, canAdopt: false })
      expect(errorCode(() => adoptDistrictSchool(db, actor, 1, id, sued, TODAY, NOW))).toBe('school_district_changed')
    })

    it('uses the facility’s own list before the Träger’s, and never another facility’s', () => {
      const actor = editor()
      const krippe = addFacility(db, 'Krippe')
      const id = createChild(db, actor, 1, master({ address: 'Ahornweg 4' }), NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toBeNull()
      saveSchoolDistrictList(db, as('admin', krippe), krippe, list([row('Ahornweg', 2, 14, '09')]), NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toBeNull()
      saveSchoolDistrictList(db, provider, null, list([row('Ahornweg', 2, 14, '01')]), NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toMatchObject({ status: 'match', code: '01', scope: 'global' })
      saveSchoolDistrictList(db, leitung, 1, list([row('Ahornweg', 2, 14, '04')]), NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toMatchObject({ status: 'match', code: '04', scope: 'facility' })
      // The krippe's settings show its own list and the Träger's, not facility 1's.
      expect(schoolDistrictSettings(db, krippe)).toMatchObject({ own: { rows: [row('Ahornweg', 2, 14, '09')] }, global: { rows: [row('Ahornweg', 2, 14, '01')] } })
      deleteSchoolDistrictList(db, 1)
      expect(getChild(db, actor, id, TODAY).districtMatch).toMatchObject({ code: '01', scope: 'global' })
    })

    it('offers „Übernehmen“ only for a school the facility may choose, with the record’s write rules', () => {
      // (Who may call it at all is the route's children.edit guard, pinned in tests/api/permissions.test.ts.)
      const actor = editor()
      const krippe = addFacility(db, 'Krippe')
      const global = createContact(db, provider, contact({ scope: 'all', categoryName: 'Grundschulen', organisation: 'Waldschule' }), NOW)
      const foreign = createContact(db, as('admin', krippe), contact({ categoryId: schoolsCategory(krippe), organisation: 'Krippenschule' }), NOW)
      saveSchoolDistrictList(db, provider, null, list([row('Ahornweg', 2, 14, '04'), row('Birkenweg', 1, 9, '05')], [
        { code: '04', name: 'Waldschule', contactId: global },
      ]), NOW)
      const id = createChild(db, actor, 1, master({ address: 'Ahornweg 4' }), NOW)
      expect(getChild(db, actor, id, TODAY).districtMatch).toMatchObject({ contactId: global, canAdopt: true })
      // Another facility's child is not found; a left child cannot be changed.
      expect(errorCode(() => adoptDistrictSchool(db, actor, krippe, id, global, TODAY, NOW))).toBe('child_not_found')
      db.update(children).set({ leftOn: '2027-01-31' }).where(eq(children.id, id)).run()
      expect(errorCode(() => adoptDistrictSchool(db, actor, 1, id, global, TODAY, NOW))).toBe('child_archived')
      db.update(children).set({ leftOn: null }).where(eq(children.id, id)).run()
      adoptDistrictSchool(db, actor, 1, id, global, TODAY, NOW)
      expect(getChild(db, actor, id, TODAY).master.futureSchoolContactId).toBe(global)

      // The krippe maps the district to its own school: offered there, never to facility 1 (which keeps the Träger's list).
      db.update(children).set({ futureSchoolContactId: null, address: 'Birkenweg 3' }).where(eq(children.id, id)).run()
      saveSchoolDistrictList(db, as('admin', krippe), krippe, list([row('Birkenweg', 1, 9, '05')], [{ code: '05', name: '', contactId: foreign }]), NOW)
      expect(schoolDistrictMatcher(db, krippe)({ address: 'Birkenweg 3', futureSchoolContactId: null })).toMatchObject({ contactId: foreign, canAdopt: true })
      expect(getChild(db, actor, id, TODAY).districtMatch).toMatchObject({ code: '05', contactId: null, canAdopt: false })
    })

    it('lists the district with the school children, from one matcher for all of them', () => {
      const actor = editor()
      saveSchoolDistrictList(db, leitung, 1, list([row('Ahornweg', 2, 14, '04'), row('Clementine-Bassermann-St', 1, 27, '02')], [{ code: '02', name: 'Südstadtschule', contactId: null }]), NOW)
      const a = createChild(db, actor, 1, master({ lastName: 'A', address: 'Clementine-Bassermann-Straße 5' }), NOW)
      const b = createChild(db, actor, 1, master({ lastName: 'B', address: 'Ahornweg 3' }), NOW)
      const c = createChild(db, actor, 1, master({ lastName: 'C' }), NOW)
      const listed = new Map(upcomingSchoolChildren(db, 1, TODAY).map(child => [child.id, child.schoolDistrict]))
      expect(listed.get(a)).toMatchObject({ status: 'match', code: '02', name: 'Südstadtschule' })
      expect(listed.get(b)).toEqual({ status: 'none', asOf: '2021', scope: 'facility' })
      expect(listed.get(c)).toBeNull()
      // The matcher looks up each street once.
      const match = schoolDistrictMatcher(db, 1)
      expect([match({ address: 'Ahornweg 4', futureSchoolContactId: null }), match({ address: 'Ahornweg 6', futureSchoolContactId: null })])
        .toEqual([expect.objectContaining({ code: '04' }), expect.objectContaining({ code: '04' })])
    })
  })
})
