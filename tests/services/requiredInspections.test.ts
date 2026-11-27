import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  employeeDocuments, employeeHours, employeeRequirements, employees, requiredDocumentTypes, requiredInspectionLog, requiredInspections, templateCategories,
} from '../../server/db/schema'
import { categoryHasData, deleteCategories } from '../../server/services/employeeDeletion'
import {
  deleteEmployeeDocument, listEmployeeDocuments, replaceEmployeeDocumentFile, updateEmployeeDocument, uploadEmployeeDocument,
} from '../../server/services/employeeDocuments'
import { createFacility } from '../../server/services/facilities'
import { uploadTemplate } from '../../server/services/printTemplates'
import { listReminders } from '../../server/services/reminders'
import {
  createRequiredType, deleteInspection, deleteRequiredType, employeeRequiredDocuments, linkRequiredDocument, listRequiredTypes,
  missingRequiredDocuments, recordInspection, storedInspectionFileList, updateRequiredType, uploadRequiredDocument, type RequiredDocsActor,
} from '../../server/services/requiredDocuments'
import { addRequirementRecord, clearCriminalRecordNote, criminalRecordNotes } from '../../server/services/requirements'
import { deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { createSignRequest, listSignRequests, signMyRequest } from '../../server/services/signRequests'
import { createCategory } from '../../server/services/templateCategories'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { RequiredDocumentTypeInput, SessionUser } from '../../shared/types/api'
import { fillablePdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, asChildViewer, createTestDb, errorCode, requirementTypeId } from '../helpers/fixtures'

const TODAY = '2026-11-26'
const NOW = new Date('2026-11-26T09:00:00.000Z')
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const file = { data: PDF, filename: 'scan.pdf' }

/**
 * „nur Einsicht vermerken“ (§ 72a Abs. 5 SGB VIII): the Erweitertes Führungszeugnis is recorded as an inspection – the
 * certificate's date, optionally the day of inspection, „keine einschlägige Eintragung“, who and when – never kept as a
 * file; its retention, the files to clean up (marked, whatever happens to them) and the audit lines.
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
  /** Records the certificate's date (the validity counts from it); the day of inspection is optional. */
  const record = (certificateDate: string, noRelevantEntry = true, viewer = actor(traeger), inspectedOn: string | null = null) =>
    recordInspection(db, viewer, 1, anna, efz, { certificateDate, inspectedOn, noRelevantEntry }, TODAY, NOW)
  const input = (overrides: Partial<RequiredDocumentTypeInput> = {}): RequiredDocumentTypeInput => ({
    name: 'Erweitertes Führungszeugnis', folder: 'required', appliesTo: 'all', validityMonths: 60, templateId: null, active: true, mode: 'inspection',
    ...overrides,
  })
  const facilities = (...ids: number[]) => ids.map(id => ({ id, name: id === 1 ? 'Kita' : `Haus ${id}` }))
  /** An old upload of the Führungszeugnis from the time it was a file type: linked, and marked as the migration does. */
  const oldFile = (title = 'FZ 2024', employeeId = anna, facilityId = 1, typeId = efz) => {
    const id = uploadEmployeeDocument(db, actor(traeger), facilityId, employeeId, { folder: 'required', title, documentDate: '2024-03-01', note: '' }, file, NOW)
    db.update(employeeDocuments).set({ requiredTypeId: typeId, inspectionCleanup: true, inspectionTypeId: typeId }).where(eq(employeeDocuments.id, id)).run()
    return id
  }

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

  it('records the certificate\'s date (the validity runs from it), the day of inspection if given, and the box', () => {
    expect(row()).toMatchObject({ mode: 'inspection', state: 'missing', inspection: null, templateId: null, storedFiles: [], history: [] })
    record('2026-08-01', true, actor(traeger), '2026-11-20')
    expect(row()).toMatchObject({
      state: 'present', date: '2026-08-01', expiresOn: '2031-08-01',
      inspection: { certificateDate: '2026-08-01', inspectedOn: '2026-11-20', noRelevantEntry: true, recordedBy: 'traeger', recordedAt: NOW.toISOString() },
    })
    // Recording again replaces the record (one per person and type); the day of inspection may be left out.
    record('2021-12-01')
    expect(row()).toMatchObject({ state: 'expiring', expiresOn: '2026-12-01', inspection: { inspectedOn: null } })
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

  it('refuses dates after today, an inspection before the certificate, a file type, another facility and a viewer without the folder key', () => {
    expect(errorCode(() => record('2026-11-27'))).toBe('certificate_date_future')
    expect(errorCode(() => record('2026-02-30'))).toBe('certificate_date_invalid')
    expect(errorCode(() => record('2026-11-01', true, actor(traeger), '2026-11-27'))).toBe('inspection_date_future')
    expect(errorCode(() => record('2026-11-01', true, actor(traeger), '2026-02-30'))).toBe('inspection_date_invalid')
    expect(errorCode(() => record('2026-11-01', true, actor(traeger), '2026-10-31'))).toBe('inspection_before_certificate')
    expect(db.select().from(requiredInspections).all()).toEqual([])
    const contract = db.select().from(requiredDocumentTypes).all().find(type => type.facilityId === 1 && type.name === 'Arbeitsvertrag')!.id
    expect(errorCode(() => recordInspection(db, actor(traeger), 1, anna, contract, { certificateDate: TODAY, inspectedOn: null, noRelevantEntry: true }, TODAY, NOW)))
      .toBe('required_type_not_inspection')
    // Only with the key of the folder „Pflichtdokumente“ (the Leitung's by default); without it the type is not even there.
    expect(errorCode(() => record(TODAY, true, limited(['employees.docs.qualifications'])))).toBe('forbidden')
    expect(employeeRequiredDocuments(db, limited(['employees.docs.qualifications']), 1, anna, TODAY).find(entry => entry.typeId === efz)).toBeUndefined()
    record(TODAY, true, limited(['employees.docs.required']))
    expect(row(limited(['employees.docs.required'])).state).toBe('present')
    // Another facility's employee or type is unknown – for recording and for deleting.
    const krippe = addFacility(db, 'Krippe')
    const other = addEmployee(db, 'Ben Anders', { facilityId: krippe })
    const fine = { certificateDate: TODAY, inspectedOn: null, noRelevantEntry: true }
    expect(errorCode(() => recordInspection(db, actor(traeger), 1, other, efz, fine, TODAY, NOW))).toBe('employee_not_found')
    expect(errorCode(() => recordInspection(db, actor(traeger), krippe, other, efz, fine, TODAY, NOW))).toBe('required_type_not_found')
    expect(errorCode(() => deleteInspection(db, actor(traeger), 1, other, efz))).toBe('employee_not_found')
    expect(errorCode(() => deleteInspection(db, actor(traeger), krippe, anna, efz))).toBe('required_type_not_found')
    // „Vermerk löschen“ needs the folder key too.
    expect(errorCode(() => deleteInspection(db, limited(['employees.docs.qualifications']), 1, anna, efz))).toBe('forbidden')
    expect(db.select().from(requiredInspections).all()).toHaveLength(1)
  })

  it('logs who recorded, changed and deleted the record and when – nothing of its content', () => {
    const leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Lea Leitung'))
    record('2026-08-01')
    recordInspection(db, actor(leitung), 1, anna, efz, { certificateDate: '2026-08-01', inspectedOn: null, noRelevantEntry: false }, TODAY,
      new Date('2026-11-26T10:00:00.000Z'))
    deleteInspection(db, actor(traeger), 1, anna, efz, new Date('2026-11-26T11:00:00.000Z'))
    // Deleting nothing logs nothing.
    deleteInspection(db, actor(traeger), 1, anna, efz, new Date('2026-11-26T12:00:00.000Z'))
    expect(row().history).toEqual([
      { action: 'deleted', by: 'traeger', at: '2026-11-26T11:00:00.000Z' },
      { action: 'changed', by: 'Lea Leitung', at: '2026-11-26T10:00:00.000Z' },
      { action: 'recorded', by: 'traeger', at: NOW.toISOString() },
    ])
    expect(Object.keys(db.select().from(requiredInspectionLog).get()!).sort()).toEqual(['action', 'actor', 'at', 'employeeId', 'id', 'typeId'])
    // The lines belong to the record's retention category; a deleted type leaves them without the type.
    expect(categoryHasData(db, anna).inspection).toBe(true)
    deleteRequiredType(db, actor(traeger), 1, efz)
    expect(db.select({ typeId: requiredInspectionLog.typeId }).from(requiredInspectionLog).all()).toEqual([{ typeId: null }, { typeId: null }, { typeId: null }])
    expect(db.transaction(tx => deleteCategories(tx, anna, ['inspection'])).inspection).toBe(3)
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

  it('files a copy signed after the switch unlinked and marked, and tells the sender', () => {
    db.delete(templateCategories).run()
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    const template = uploadTemplate(db, sender, { title: 'Bogen', categoryId: createCategory(db, sender, { name: 'Personal', visibility: 'all' }), scope: 'facility' },
      { data: fillablePdf(), filename: 'b.pdf' }, NOW)
    // Sent while the type still kept a file …
    updateRequiredType(db, actor(traeger), 1, efz, input({ mode: 'file' }))
    createSignRequest(db, sender, {
      title: 'Führungszeugnis', sourceKind: 'template', sourceId: template, recipientIds: [anna], folder: 'required', dueDate: null, note: '', requiredTypeId: efz,
    }, null, NOW)
    // … signed after it became „nur Einsicht vermerken“.
    updateRequiredType(db, actor(traeger), 1, efz, input())
    const recipientId = listSignRequests(db, sender, TODAY)[0]!.recipients[0]!.id
    const { documentId } = signMyRequest(db, { employeeId: anna, userId: null }, recipientId, Buffer.concat([fillablePdf(), Buffer.from('% signed\n')]), NOW)
    expect(db.select({ requiredTypeId: employeeDocuments.requiredTypeId, folder: employeeDocuments.folder, cleanup: employeeDocuments.inspectionCleanup,
      inspectionTypeId: employeeDocuments.inspectionTypeId }).from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get())
      .toEqual({ requiredTypeId: null, folder: 'required', cleanup: true, inspectionTypeId: efz })
    expect(row()).toMatchObject({ state: 'missing', storedFiles: [{ id: documentId }] })
    expect(storedInspectionFileList(db, actor(traeger), facilities(1)).map(entry => entry.documentId)).toEqual([documentId])
    expect(listSignRequests(db, sender, TODAY)[0]!.recipients[0]).toMatchObject({ status: 'signed', copyInspectionOnly: true })
  })

  it('refuses „Bearbeiten“ of a file that must not be kept, and linking or sending it; deleting stays', () => {
    const old = oldFile()
    expect(errorCode(() => replaceEmployeeDocumentFile(db, actor(traeger), 1, old, { data: fillablePdf(), filename: 'x.pdf' }, NOW))).toBe('document_inspection_file')
    // Still linked but never marked (e.g. linked by hand to a type „nur Einsicht“ before the marker): refused as well.
    const linked = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'required', title: 'FZ', documentDate: TODAY, note: '' }, file, NOW)
    db.update(employeeDocuments).set({ requiredTypeId: efz }).where(eq(employeeDocuments.id, linked)).run()
    expect(errorCode(() => replaceEmployeeDocumentFile(db, actor(traeger), 1, linked, { data: fillablePdf(), filename: 'x.pdf' }, NOW))).toBe('document_inspection_file')
    const masern = db.select().from(requiredDocumentTypes).all().find(type => type.facilityId === 1 && type.name === 'Masernnachweis')!.id
    expect(errorCode(() => linkRequiredDocument(db, actor(traeger), 1, old, masern))).toBe('document_inspection_file')
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    expect(errorCode(() => createSignRequest(db, sender, {
      title: 'FZ', sourceKind: 'document', sourceId: old, recipientIds: [anna], folder: 'required', dueDate: null, note: '',
    }, null, NOW))).toBe('document_inspection_file')
    expect(listEmployeeDocuments(db, actor(traeger), 1, anna).required!.find(document => document.id === old)).toMatchObject({ inspectionFile: true })
    deleteEmployeeDocument(db, actor(traeger), 1, old)
    expect(storedInspectionFileList(db, actor(traeger), facilities(1)).map(entry => entry.documentId)).toEqual([linked])
  })

  it('keeps a marked file on the cleanup list when it is moved or unlinked; the switches set and clear the marker', () => {
    const old = oldFile()
    const listed = () => storedInspectionFileList(db, actor(traeger), facilities(1)).map(entry => entry.documentId)
    linkRequiredDocument(db, actor(traeger), 1, old, null)
    expect(listed()).toEqual([old])
    updateEmployeeDocument(db, actor(traeger), 1, old, { folder: 'application', title: 'FZ 2024', documentDate: '2024-03-01', note: '' })
    expect(listed()).toEqual([old])
    expect(row().storedFiles.map(entry => entry.id)).toEqual([old])
    // A type switched to „nur Einsicht“ marks its linked files; switched back, they are regular again.
    const masern = db.select().from(requiredDocumentTypes).all().find(type => type.facilityId === 1 && type.name === 'Masernnachweis')!.id
    const proof = uploadRequiredDocument(db, actor(traeger), 1, anna, masern, { title: 'Impfpass', documentDate: TODAY, note: '' }, file, NOW)
    updateRequiredType(db, actor(traeger), 1, masern, input({ name: 'Masernnachweis', validityMonths: null }))
    expect(listed()).toEqual([old, proof])
    expect(storedInspectionFileList(db, actor(traeger), facilities(1)).find(entry => entry.documentId === proof))
      .toMatchObject({ typeName: 'Masernnachweis', certificate: false })
    updateRequiredType(db, actor(traeger), 1, masern, input({ name: 'Masernnachweis', validityMonths: null, mode: 'file' }))
    expect(listed()).toEqual([old])
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(entry => entry.typeId === masern)).toMatchObject({ state: 'present', documentId: proof })
    // The type deleted: the marker stays, without the type's name.
    deleteRequiredType(db, actor(traeger), 1, efz)
    expect(storedInspectionFileList(db, actor(traeger), facilities(1))).toMatchObject([{ documentId: old, typeName: '', certificate: false }])
  })

  it('keeps a record visible and deletable after its type is switched back to „Datei“, an entry still to check', () => {
    record('2026-08-01', false)
    updateRequiredType(db, actor(traeger), 1, efz, input({ mode: 'file' }))
    expect(row()).toMatchObject({ mode: 'file', state: 'entry', inspection: { certificateDate: '2026-08-01', noRelevantEntry: false } })
    expect(missingRequiredDocuments(db, actor(traeger), 1, TODAY).get(anna)).toContainEqual({ typeId: efz, name: 'Erweitertes Führungszeugnis', state: 'entry' })
    // Read only: no new record under „Datei“ …
    expect(errorCode(() => record('2026-09-01'))).toBe('required_type_not_inspection')
    // … but „Vermerk löschen“ works whatever the mode.
    deleteInspection(db, actor(traeger), 1, anna, efz)
    expect(row()).toMatchObject({ state: 'missing', inspection: null })
    // With the box ticked the record is shown, the status comes from the files.
    updateRequiredType(db, actor(traeger), 1, efz, input())
    record('2026-08-01')
    updateRequiredType(db, actor(traeger), 1, efz, input({ mode: 'file' }))
    expect(row()).toMatchObject({ state: 'missing', inspection: { noRelevantEntry: true } })
  })

  it('lists files to clean up in every facility given – only to whoever may use their folder – and offers to delete them', () => {
    const old = oldFile()
    uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'required', title: 'Masern', documentDate: '2024-03-01', note: '' }, file, NOW)
    expect(storedInspectionFileList(db, actor(traeger), facilities(1))).toEqual([{
      documentId: old, employeeId: anna, employeeName: 'Anna Probe', facilityId: 1, facilityName: 'Kita', typeName: 'Erweitertes Führungszeugnis',
      certificate: true, title: 'FZ 2024', documentDate: '2024-03-01',
    }])
    expect(storedInspectionFileList(db, limited(['employees.docs.qualifications']), facilities(1))).toEqual([])
    // The file does not count: the status comes from the inspection only.
    expect(row()).toMatchObject({ state: 'missing', documentId: null, storedFiles: [{ id: old, title: 'FZ 2024', documentDate: '2024-03-01' }] })
    // The other facilities the viewer may see are listed too, each named; one not given is not.
    const krippe = addFacility(db, 'Krippe')
    const ben = addEmployee(db, 'Ben Anders', { facilityId: krippe })
    const krippeType = db.select().from(requiredDocumentTypes).all().find(type => type.facilityId === krippe && type.name === 'Erweitertes Führungszeugnis')!.id
    const bens = oldFile('FZ Ben', ben, krippe, krippeType)
    expect(storedInspectionFileList(db, actor(traeger), facilities(1, krippe)).map(entry => [entry.documentId, entry.facilityName]))
      .toEqual([[old, 'Kita'], [bens, `Haus ${krippe}`]])
    expect(storedInspectionFileList(db, actor(traeger), facilities(1)).map(entry => entry.documentId)).toEqual([old])
  })

  it('may delete the record from the day after leaving; „spätestens bis“ 3 months later, red and reminded once passed', () => {
    record('2026-01-15')
    db.update(employees).set({ leftOn: '2026-08-20' }).where(eq(employees.id, anna)).run()
    expect(categoryHasData(db, anna).inspection).toBe(true)
    const item = (today = TODAY) => retentionOverview(db, today).find(entry => entry.key === `employee:${anna}:inspection`)!
    expect(item('2026-08-21')).toMatchObject({ category: 'inspection', deletableFrom: '2026-08-21', due: true, inspection: { deleteBy: '2026-11-20', overdue: false } })
    expect(item('2026-11-20')).toMatchObject({ due: true, inspection: { overdue: false } })
    expect(item('2026-11-21')).toMatchObject({ due: true, inspection: { deleteBy: '2026-11-20', overdue: true } })
    // Past the deadline it comes first and the Träger is reminded in red (next to the count of due items).
    expect(retentionOverview(db, TODAY)[0]!.key).toBe(`employee:${anna}:inspection`)
    const reminders = listReminders(db, asChildViewer(traeger), TODAY).filter(entry => entry.kind === 'retention')
    expect(reminders.map(entry => [entry.state, entry.count])).toContainEqual(['overdue', 1])
    // Not taken up: the activity would have started after the leaving day – deletable at once, overdue at once.
    db.update(employees).set({ leftOn: '2026-11-24', employedSince: '2026-12-01' }).where(eq(employees.id, anna)).run()
    expect(item()).toMatchObject({ deletableFrom: '2026-11-25', due: true, inspection: { deleteBy: null, overdue: true } })
    // Without „beschäftigt seit“ the first weekly hours count (as „Einstellen“ of an applicant enters them).
    db.update(employees).set({ employedSince: null }).where(eq(employees.id, anna)).run()
    db.delete(employeeHours).where(eq(employeeHours.employeeId, anna)).run()
    db.insert(employeeHours).values({ employeeId: anna, validFrom: '2026-12-01', weeklyMinutes: 1200 }).run()
    expect(item()).toMatchObject({ inspection: { deleteBy: null, overdue: true } })
    deleteRetentionItem(db, traeger, `employee:${anna}:inspection`, TODAY, NOW)
    expect(db.select().from(requiredInspections).all()).toEqual([])
    expect(categoryHasData(db, anna).inspection).toBe(false)
    expect(listReminders(db, asChildViewer(traeger), TODAY).filter(entry => entry.kind === 'retention' && entry.state === 'overdue')).toEqual([])
  })
})

/**
 * The Pflichttermin „Erweitertes Führungszeugnis“ (criminal_record) holds the same § 72a data: the record's retention, no
 * note (old ones listed for deleting by hand); every other Pflichttermin keeps its note and its 3 years.
 */
describe('Pflichttermin „Erweitertes Führungszeugnis“', () => {
  let db: Db
  let anna: number
  let criminal: number
  let firstAid: number

  beforeEach(() => {
    db = createTestDb()
    addUser(db, 'traeger', 'provider')
    anna = addEmployee(db, 'Anna Probe')
    criminal = requirementTypeId(db, 'criminal_record')
    firstAid = requirementTypeId(db, 'first_aid')
  })

  it('takes no note, every other kind does', () => {
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: criminal, date: '2026-11-01', note: 'Eintrag wegen …' }, TODAY)))
      .toBe('requirement_note_not_allowed')
    addRequirementRecord(db, 1, anna, { typeId: criminal, date: '2026-11-01', note: '  ' }, TODAY)
    addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2026-11-01', note: 'Kurs beim DRK' }, TODAY)
    expect(db.select({ typeId: employeeRequirements.typeId, note: employeeRequirements.note }).from(employeeRequirements).all())
      .toEqual([{ typeId: criminal, note: null }, { typeId: firstAid, note: 'Kurs beim DRK' }])
  })

  it('lists old notes for deleting by hand and removes only those (the day stays)', () => {
    const old = db.insert(employeeRequirements).values({ employeeId: anna, typeId: criminal, date: '2025-05-01', note: 'alte Notiz' })
      .returning({ id: employeeRequirements.id }).get().id
    const kept = addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2026-11-01', note: 'Kurs' }, TODAY)
    expect(criminalRecordNotes(db, [{ id: 1, name: 'Kita' }])).toEqual([
      { id: old, employeeId: anna, employeeName: 'Anna Probe', facilityId: 1, facilityName: 'Kita', date: '2025-05-01' },
    ])
    expect(errorCode(() => clearCriminalRecordNote(db, 1, kept))).toBe('requirement_not_found')
    expect(errorCode(() => clearCriminalRecordNote(db, addFacility(db, 'Krippe'), old))).toBe('requirement_not_found')
    clearCriminalRecordNote(db, 1, old)
    expect(criminalRecordNotes(db, [{ id: 1, name: 'Kita' }])).toEqual([])
    expect(db.select({ id: employeeRequirements.id, date: employeeRequirements.date, note: employeeRequirements.note }).from(employeeRequirements).all())
      .toEqual([{ id: old, date: '2025-05-01', note: null }, { id: kept, date: '2026-11-01', note: 'Kurs' }])
  })

  it('goes with the inspection records (deadline 3 months after leaving), the other kinds with the assessments (3 years)', () => {
    addRequirementRecord(db, 1, anna, { typeId: criminal, date: '2026-01-10' }, TODAY)
    addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2026-01-10' }, TODAY)
    db.update(employees).set({ leftOn: '2026-08-20' }).where(eq(employees.id, anna)).run()
    expect(categoryHasData(db, anna)).toMatchObject({ inspection: true, assessment: true })
    const items = retentionOverview(db, TODAY).filter(entry => entry.key.startsWith(`employee:${anna}:`))
    expect(items.find(entry => entry.category === 'inspection')).toMatchObject({ deletableFrom: '2026-08-21', inspection: { deleteBy: '2026-11-20', overdue: true } })
    expect(items.find(entry => entry.category === 'assessment')).toMatchObject({ deletableFrom: '2030-01-01' })
    expect(db.transaction(tx => deleteCategories(tx, anna, ['inspection'])).inspection).toBe(1)
    expect(db.select({ typeId: employeeRequirements.typeId }).from(employeeRequirements).all()).toEqual([{ typeId: firstAid }])
    expect(categoryHasData(db, anna).inspection).toBe(false)
    expect(db.transaction(tx => deleteCategories(tx, anna, ['assessment'])).assessment).toBe(1)
  })
})
