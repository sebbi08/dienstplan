import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeDocuments, employeeHours, employees, requiredDocumentTypes, requiredInspections, templateCategories } from '../../server/db/schema'
import { categoryHasData } from '../../server/services/employeeDeletion'
import { uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { createFacility } from '../../server/services/facilities'
import { uploadTemplate } from '../../server/services/printTemplates'
import {
  createRequiredType, deleteInspection, employeeRequiredDocuments, linkRequiredDocument, listRequiredTypes, missingRequiredDocuments,
  recordInspection, storedInspectionFileList, updateRequiredType, uploadRequiredDocument, type RequiredDocsActor,
} from '../../server/services/requiredDocuments'
import { deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { createSignRequest } from '../../server/services/signRequests'
import { createCategory } from '../../server/services/templateCategories'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { RequiredDocumentTypeInput, SessionUser } from '../../shared/types/api'
import { fillablePdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-11-26'
const NOW = new Date('2026-11-26T09:00:00.000Z')
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const file = { data: PDF, filename: 'scan.pdf' }

/**
 * „nur Einsicht vermerken“ (§ 72a Abs. 5 SGB VIII): the Erweitertes Führungszeugnis is recorded as an inspection – day,
 * „keine einschlägige Eintragung“, who and when – never kept as a file; its retention and the old files to clean up.
 */
describe('Pflichtdokumente „nur Einsicht vermerken“ (Führungszeugnis)', () => {
  let db: Db
  let traeger: SessionUser
  let anna: number
  let efz: number
  const actor = (user: SessionUser): RequiredDocsActor => ({ id: user.id, role: user.role, permissions: user.permissions })
  const limited = (keys: PermissionKey[]): RequiredDocsActor => ({
    id: traeger.id, role: 'admin', permissions: new Set<PermissionKey>(['employees.view', 'settings.facility', ...keys]),
  })
  const row = (viewer = actor(traeger), employeeId = anna) =>
    employeeRequiredDocuments(db, viewer, 1, employeeId, TODAY).find(entry => entry.typeId === efz)!
  const record = (inspectedOn: string, noRelevantEntry = true, viewer = actor(traeger)) =>
    recordInspection(db, viewer, 1, anna, efz, { inspectedOn, noRelevantEntry }, TODAY, NOW)
  const input = (overrides: Partial<RequiredDocumentTypeInput> = {}): RequiredDocumentTypeInput => ({
    name: 'Erweitertes Führungszeugnis', folder: 'required', appliesTo: 'all', validityMonths: 60, templateId: null, active: true, mode: 'inspection',
    ...overrides,
  })

  beforeEach(() => {
    db = createTestDb()
    traeger = addUser(db, 'traeger', 'provider')
    anna = addEmployee(db, 'Anna Probe')
    efz = db.select().from(requiredDocumentTypes).where(eq(requiredDocumentTypes.facilityId, 1)).all()
      .find(type => type.name === 'Erweitertes Führungszeugnis')!.id
  })

  it('makes the example „nur Einsicht vermerken“ – existing facilities by the migration, new ones when created – and nothing else', () => {
    const modes = (facilityId: number) => Object.fromEntries(listRequiredTypes(db, actor(traeger), facilityId).map(type => [type.name, type.mode]))
    expect(modes(1)).toEqual({
      'Arbeitsvertrag': 'file', 'Erweitertes Führungszeugnis': 'inspection', 'Masernnachweis': 'file', 'Belehrung Infektionsschutz': 'file',
      'Verpflichtung auf den Datenschutz': 'file', 'Erste-Hilfe-Nachweis': 'file', 'Schweigepflichterklärung': 'file',
    })
    expect(modes(createFacility(db, 'Krippe').id)).toEqual(modes(1))
    // The settings choose the mode; a type „nur Einsicht“ keeps no template.
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    db.delete(templateCategories).run()
    const template = uploadTemplate(db, sender, { title: 'Bogen', categoryId: createCategory(db, sender, { name: 'Personal', visibility: 'all' }), scope: 'facility' },
      { data: fillablePdf(), filename: 'b.pdf' }, NOW)
    const own = createRequiredType(db, actor(traeger), 1, input({ name: 'Eigene Einsicht', templateId: template }))
    expect(listRequiredTypes(db, actor(traeger), 1).find(type => type.id === own)).toMatchObject({ mode: 'inspection', templateId: null })
    updateRequiredType(db, actor(traeger), 1, own, input({ name: 'Eigene Einsicht', mode: 'file', templateId: template }))
    expect(listRequiredTypes(db, actor(traeger), 1).find(type => type.id === own)).toMatchObject({ mode: 'file', templateId: template })
  })

  it('records the day and the box; the status follows them and the validity runs from the day of inspection', () => {
    expect(row()).toMatchObject({ mode: 'inspection', state: 'missing', inspection: null, templateId: null, storedFiles: [] })
    record('2026-11-02')
    expect(row()).toMatchObject({
      state: 'present', date: '2026-11-02', expiresOn: '2031-11-02',
      inspection: { inspectedOn: '2026-11-02', noRelevantEntry: true, recordedBy: 'traeger', recordedAt: NOW.toISOString() },
    })
    // Recording again replaces the record (one per person and type).
    record('2021-12-01')
    expect(row()).toMatchObject({ state: 'expiring', expiresOn: '2026-12-01' })
    record('2021-01-10')
    expect(row()).toMatchObject({ state: 'expired', expiresOn: '2026-01-10' })
    expect(db.select().from(requiredInspections).all()).toHaveLength(1)
    // Without „keine einschlägige Eintragung“: an entry to check, whatever the date; it counts as missing in the lists.
    record('2026-11-02', false)
    expect(row()).toMatchObject({ state: 'entry', date: '2026-11-02', expiresOn: null })
    expect(missingRequiredDocuments(db, actor(traeger), 1, TODAY).get(anna)).toContainEqual({ typeId: efz, name: 'Erweitertes Führungszeugnis', state: 'entry' })
    // A correction removes it.
    deleteInspection(db, actor(traeger), 1, anna, efz)
    expect(row().state).toBe('missing')
  })

  it('refuses a day after today or no date, a file type, another facility and a viewer without the folder key', () => {
    expect(errorCode(() => record('2026-11-27'))).toBe('inspection_date_future')
    expect(errorCode(() => record('2026-02-30'))).toBe('inspection_date_invalid')
    const contract = db.select().from(requiredDocumentTypes).all().find(type => type.facilityId === 1 && type.name === 'Arbeitsvertrag')!.id
    expect(errorCode(() => recordInspection(db, actor(traeger), 1, anna, contract, { inspectedOn: TODAY, noRelevantEntry: true }, TODAY, NOW)))
      .toBe('required_type_not_inspection')
    // Only with the key of the folder „Pflichtdokumente“ (the Leitung's by default); without it the type is not even there.
    expect(errorCode(() => record(TODAY, true, limited(['employees.docs.qualifications'])))).toBe('forbidden')
    expect(employeeRequiredDocuments(db, limited(['employees.docs.qualifications']), 1, anna, TODAY).find(entry => entry.typeId === efz)).toBeUndefined()
    record(TODAY, true, limited(['employees.docs.required']))
    expect(row(limited(['employees.docs.required'])).state).toBe('present')
    // Another facility's employee or type is unknown.
    const krippe = addFacility(db, 'Krippe')
    const other = addEmployee(db, 'Ben Anders', { facilityId: krippe })
    expect(errorCode(() => recordInspection(db, actor(traeger), 1, other, efz, { inspectedOn: TODAY, noRelevantEntry: true }, TODAY, NOW))).toBe('employee_not_found')
    expect(errorCode(() => recordInspection(db, actor(traeger), krippe, other, efz, { inspectedOn: TODAY, noRelevantEntry: true }, TODAY, NOW)))
      .toBe('required_type_not_found')
  })

  it('takes no file: no upload, no link, no fill into it and no request to sign', () => {
    expect(errorCode(() => uploadRequiredDocument(db, actor(traeger), 1, anna, efz, { title: '', documentDate: TODAY, note: '' }, file, NOW)))
      .toBe('required_type_inspection_only')
    expect(errorCode(() => uploadRequiredDocument(db, actor(traeger), 1, anna, efz, { title: '', documentDate: TODAY, note: '', folder: 'required' }, file, NOW)))
      .toBe('required_type_inspection_only')
    const scan = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'required', title: 'Scan', documentDate: TODAY, note: '' }, file, NOW)
    expect(errorCode(() => linkRequiredDocument(db, actor(traeger), 1, scan, efz))).toBe('required_type_inspection_only')
    db.delete(templateCategories).run()
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    const template = uploadTemplate(db, sender, { title: 'Bogen', categoryId: createCategory(db, sender, { name: 'Personal', visibility: 'all' }), scope: 'facility' },
      { data: fillablePdf(), filename: 'b.pdf' }, NOW)
    expect(errorCode(() => createSignRequest(db, sender, {
      title: 'Führungszeugnis', sourceKind: 'template', sourceId: template, recipientIds: [anna], folder: 'required', dueDate: null, note: '', requiredTypeId: efz,
    }, null, NOW))).toBe('required_type_inspection_only')
  })

  it('lists files kept from before for cleaning up – only to whoever may use their folder – and offers to delete them', () => {
    // An upload of the Führungszeugnis from the time it was a file type.
    const old = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'required', title: 'FZ 2024', documentDate: '2024-03-01', note: '' }, file, NOW)
    db.update(employeeDocuments).set({ requiredTypeId: efz }).where(eq(employeeDocuments.id, old)).run()
    uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'required', title: 'Masern', documentDate: '2024-03-01', note: '' }, file, NOW)
    expect(storedInspectionFileList(db, actor(traeger), 1)).toEqual([
      { documentId: old, employeeId: anna, employeeName: 'Anna Probe', typeName: 'Erweitertes Führungszeugnis', title: 'FZ 2024', documentDate: '2024-03-01' },
    ])
    expect(storedInspectionFileList(db, limited(['employees.docs.qualifications']), 1)).toEqual([])
    // The file does not count: the status comes from the inspection only.
    expect(row()).toMatchObject({ state: 'missing', documentId: null, storedFiles: [{ id: old, title: 'FZ 2024', documentDate: '2024-03-01' }] })
    // Another facility does not see it.
    expect(storedInspectionFileList(db, actor(traeger), addFacility(db, 'Krippe'))).toEqual([])
  })

  it('may delete the record 3 months after leaving, or at once when the activity was not taken up', () => {
    record('2026-01-15')
    db.update(employees).set({ leftOn: '2026-08-20' }).where(eq(employees.id, anna)).run()
    expect(categoryHasData(db, anna).inspection).toBe(true)
    const item = () => retentionOverview(db, TODAY).find(entry => entry.key === `employee:${anna}:inspection`)!
    expect(item()).toMatchObject({ category: 'inspection', deletableFrom: '2026-11-20', due: true })
    expect(retentionOverview(db, '2026-11-19').find(entry => entry.key === `employee:${anna}:inspection`)).toMatchObject({ due: false })
    // Not taken up: the activity would have started after the leaving day.
    db.update(employees).set({ leftOn: '2026-11-20', employedSince: '2026-12-01' }).where(eq(employees.id, anna)).run()
    expect(item()).toMatchObject({ deletableFrom: '2026-11-21', due: true })
    // Without „beschäftigt seit“ the first weekly hours count (as „Einstellen“ of an applicant enters them).
    db.update(employees).set({ employedSince: null }).where(eq(employees.id, anna)).run()
    db.delete(employeeHours).where(eq(employeeHours.employeeId, anna)).run()
    db.insert(employeeHours).values({ employeeId: anna, validFrom: '2026-12-01', weeklyMinutes: 1200 }).run()
    expect(item()).toMatchObject({ deletableFrom: '2026-11-21' })
    deleteRetentionItem(db, traeger, `employee:${anna}:inspection`, TODAY, NOW)
    expect(db.select().from(requiredInspections).all()).toEqual([])
    expect(categoryHasData(db, anna).inspection).toBe(false)
  })
})
