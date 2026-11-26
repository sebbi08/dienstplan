import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeDocuments, employees, requiredDocumentTypes, signRequestRecipients, templateCategories } from '../../server/db/schema'
import { listEmployeeDocuments, updateEmployeeDocument, uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import { createFacility } from '../../server/services/facilities'
import { uploadTemplate } from '../../server/services/printTemplates'
import {
  createRequiredType, deleteRequiredType, employeeRequiredDocuments, linkRequiredDocument, listRequiredTypes, moveRequiredType,
  updateRequiredType, uploadRequiredDocument, type RequiredDocsActor,
} from '../../server/services/requiredDocuments'
import { getSetupChecklist } from '../../server/services/setupChecklist'
import { createSignRequest, signMyRequest } from '../../server/services/signRequests'
import { createCategory } from '../../server/services/templateCategories'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { RequiredDocumentTypeInput, SessionUser } from '../../shared/types/api'
import { fillablePdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-11-25'
const NOW = new Date('2026-11-25T09:00:00.000Z')
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const file = { data: PDF, filename: 'scan.pdf' }

/**
 * Pflichtdokumente (server/services/requiredDocuments.ts): the types per facility, the status per employee, filing and
 * linking, the folder keys hiding a type everywhere, the employee list, „Was noch fehlt“ and the sign request link.
 */
describe('Pflichtdokumente', () => {
  let db: Db
  let traeger: SessionUser
  let anna: number
  let ben: number
  const actor = (user: SessionUser): RequiredDocsActor => ({ id: user.id, role: user.role, permissions: user.permissions })
  /** A Leitung with only some folder keys (and the settings). */
  const limited = (keys: PermissionKey[]): RequiredDocsActor => ({
    id: traeger.id, role: 'admin', permissions: new Set<PermissionKey>(['employees.view', 'settings.facility', 'printTemplates.view', ...keys]),
  })
  const typeId = (name: string, facilityId = 1) => db.select().from(requiredDocumentTypes)
    .where(eq(requiredDocumentTypes.facilityId, facilityId)).all().find(row => row.name === name)!.id
  const input = (overrides: Partial<RequiredDocumentTypeInput> = {}): RequiredDocumentTypeInput => ({
    name: 'Hygieneschulung', folder: 'qualifications', appliesTo: 'all', validityMonths: null, templateId: null, active: true, ...overrides,
  })
  const states = (employeeId: number, viewer = actor(traeger)) =>
    employeeRequiredDocuments(db, viewer, 1, employeeId, TODAY).map(row => [row.name, row.state])
  /** Belehrung and Erste Hilfe back in „Qualifikationen“ (the Leitung's folder by default), as before the folder „Pflichtdokumente“. */
  const keepInQualifications = () => {
    for (const [name, validityMonths] of [['Belehrung Infektionsschutz', null], ['Erste-Hilfe-Nachweis', 24]] as const) {
      updateRequiredType(db, actor(traeger), 1, typeId(name), input({ name, folder: 'qualifications', validityMonths }))
    }
  }

  beforeEach(() => {
    db = createTestDb()
    traeger = addUser(db, 'traeger', 'provider')
    anna = addEmployee(db, 'Anna Probe')
    ben = addEmployee(db, 'Ben Beispiel')
    db.update(employees).set({ qualification: 'fachkraft' }).where(eq(employees.id, anna)).run()
    db.update(employees).set({ qualification: 'praktikant' }).where(eq(employees.id, ben)).run()
  })

  it('starts every facility with the examples (the existing ones from the migration, a new one when created)', () => {
    const names = (facilityId: number) => db.select().from(requiredDocumentTypes).where(eq(requiredDocumentTypes.facilityId, facilityId))
      .all().sort((a, b) => a.sortOrder - b.sortOrder).map(row => [row.name, row.folder, row.validityMonths, row.active])
    expect(names(1)).toEqual([
      ['Arbeitsvertrag', 'contract', null, true], ['Erweitertes Führungszeugnis', 'required', 60, true],
      ['Masernnachweis', 'required', null, true], ['Belehrung Infektionsschutz', 'required', null, true],
      ['Verpflichtung auf den Datenschutz', 'required', null, true], ['Erste-Hilfe-Nachweis', 'required', 24, true],
      ['Schweigepflichterklärung', 'required', null, true],
    ])
    const krippe = createFacility(db, 'Krippe').id
    expect(names(krippe)).toEqual(names(1))
  })

  it('adds, changes, orders and deletes types, names unique per facility, folders and templates checked', () => {
    const id = createRequiredType(db, actor(traeger), 1, input({ appliesTo: ['praktikant', 'fachkraft'], validityMonths: 12 }))
    const listed = listRequiredTypes(db, actor(traeger), 1)
    expect(listed.at(-1)).toMatchObject({ id, name: 'Hygieneschulung', appliesTo: ['fachkraft', 'praktikant'], validityMonths: 12, templateTitle: null })
    expect(errorCode(() => createRequiredType(db, actor(traeger), 1, input({ name: ' hygieneschulung ' })))).toBe('required_type_name_taken')
    expect(errorCode(() => createRequiredType(db, actor(traeger), 1, input({ name: '  ' })))).toBe('required_type_name_required')
    expect(errorCode(() => createRequiredType(db, actor(traeger), 1, input({ name: 'X', validityMonths: 0 })))).toBe('required_type_invalid')
    expect(errorCode(() => createRequiredType(db, actor(traeger), 1, input({ name: 'X', templateId: 9999 })))).toBe('required_type_template_invalid')
    // Only with the settings, and only folders the editor may use.
    expect(errorCode(() => createRequiredType(db, { ...actor(traeger), permissions: new Set<PermissionKey>(['employees.docs.qualifications']) }, 1, input({ name: 'X' }))))
      .toBe('forbidden')
    expect(errorCode(() => createRequiredType(db, limited(['employees.docs.qualifications']), 1, input({ name: 'X', folder: 'salary' })))).toBe('forbidden')
    updateRequiredType(db, actor(traeger), 1, id, input({ name: 'Hygiene', appliesTo: 'all' }))
    moveRequiredType(db, actor(traeger), 1, id, 'up')
    const order = listRequiredTypes(db, actor(traeger), 1).map(type => type.name)
    expect(order.slice(-2)).toEqual(['Hygiene', 'Schweigepflichterklärung'])
    // Another facility's type is unknown.
    const krippe = addFacility(db, 'Krippe')
    expect(errorCode(() => updateRequiredType(db, actor(traeger), krippe, id, input()))).toBe('required_type_not_found')
    // Deleting keeps the linked documents (without the link).
    const documentId = uploadRequiredDocument(db, actor(traeger), 1, anna, id, { title: '', documentDate: TODAY, note: '' }, file, NOW)
    deleteRequiredType(db, actor(traeger), 1, id)
    expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get()).toMatchObject({ requiredTypeId: null, title: 'Hygiene' })
  })

  it('applies a type by qualification and tells missing, present, expiring and expired from the newest linked document', () => {
    createRequiredType(db, actor(traeger), 1, input({ name: 'Praxisanleitung', appliesTo: ['praktikant'] }))
    expect(states(anna).map(([name]) => name)).not.toContain('Praxisanleitung')
    expect(states(ben).map(([name]) => name)).toContain('Praxisanleitung')
    expect(states(anna).every(([, state]) => state === 'missing')).toBe(true)
    // The Erste-Hilfe-Nachweis (24 months): expired, then expiring with a newer one, then present.
    const firstAid = typeId('Erste-Hilfe-Nachweis')
    uploadRequiredDocument(db, actor(traeger), 1, anna, firstAid, { title: '', documentDate: '2024-01-10', note: '' }, file, NOW)
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === firstAid))
      .toMatchObject({ state: 'expired', date: '2024-01-10', expiresOn: '2026-01-10' })
    uploadRequiredDocument(db, actor(traeger), 1, anna, firstAid, { title: '', documentDate: '2025-01-10', note: '' }, file, NOW)
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === firstAid)!.state).toBe('expiring')
    const fresh = uploadRequiredDocument(db, actor(traeger), 1, anna, firstAid, { title: 'EH-Kurs', documentDate: '2026-10-01', note: '' }, file, NOW)
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === firstAid))
      .toMatchObject({ state: 'present', documentId: fresh, expiresOn: '2028-10-01' })
    // Filed in the type's folder, titled as given (else after the type).
    expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.id, fresh)).get()).toMatchObject({ folder: 'required', title: 'EH-Kurs', requiredTypeId: firstAid })
    // Inactive types are not asked for.
    updateRequiredType(db, actor(traeger), 1, typeId('Masernnachweis'), input({ name: 'Masernnachweis', folder: 'required', active: false }))
    expect(states(anna).map(([name]) => name)).not.toContain('Masernnachweis')
  })

  it('links an existing document of the type\'s folder, and removes the link', () => {
    const contract = typeId('Arbeitsvertrag')
    const scan = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'contract', title: 'Vertrag', documentDate: '2023-08-01', note: '' }, file, NOW)
    const other = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'salary', title: 'Gehalt', documentDate: '2023-08-01', note: '' }, file, NOW)
    expect(errorCode(() => linkRequiredDocument(db, actor(traeger), 1, other, contract))).toBe('required_type_folder_mismatch')
    linkRequiredDocument(db, actor(traeger), 1, scan, contract)
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === contract)).toMatchObject({ state: 'present', documentId: scan })
    expect(listEmployeeDocuments(db, actor(traeger), 1, anna).contract!.find(document => document.id === scan)!.requiredTypeId).toBe(contract)
    linkRequiredDocument(db, actor(traeger), 1, scan, null)
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === contract)!.state).toBe('missing')
    // Another facility's document is unknown.
    const krippe = addFacility(db, 'Krippe')
    expect(errorCode(() => linkRequiredDocument(db, actor(traeger), krippe, scan, null))).toBe('document_not_found')
  })

  it('leaves a type out wherever the viewer may not use its folder: settings, the box, the list, „Was noch fehlt“', () => {
    const onlyQualifications = limited(['employees.docs.qualifications'])
    // The examples: the Arbeitsvertrag in Vertrag, the rest in „Pflichtdokumente“ (the key of Bewerbung).
    expect(listRequiredTypes(db, onlyQualifications, 1)).toEqual([])
    expect(listRequiredTypes(db, limited(['employees.docs.application']), 1).map(type => type.name)).toEqual([
      'Erweitertes Führungszeugnis', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Verpflichtung auf den Datenschutz', 'Erste-Hilfe-Nachweis',
      'Schweigepflichterklärung',
    ])
    expect(listRequiredTypes(db, limited(['employees.docs.contract']), 1).map(type => type.name)).toEqual(['Arbeitsvertrag'])
    keepInQualifications()
    expect(listRequiredTypes(db, onlyQualifications, 1).map(type => type.name)).toEqual(['Belehrung Infektionsschutz', 'Erste-Hilfe-Nachweis'])
    expect(states(anna, onlyQualifications).map(([name]) => name)).toEqual(['Belehrung Infektionsschutz', 'Erste-Hilfe-Nachweis'])
    expect(errorCode(() => uploadRequiredDocument(db, onlyQualifications, 1, anna, typeId('Arbeitsvertrag'), { title: '', documentDate: TODAY, note: '' }, file, NOW)))
      .toBe('forbidden')
    const extras = listEmployeeListExtras(db, 1, TODAY, onlyQualifications.permissions)
    expect(extras.find(row => row.employeeId === anna)!.requiredDocuments!.map(row => row.name)).toEqual(['Belehrung Infektionsschutz', 'Erste-Hilfe-Nachweis'])
    // Without any folder key: no column at all.
    expect(listEmployeeListExtras(db, 1, TODAY, new Set<PermissionKey>(['employees.view']))[0]!.requiredDocuments).toBeUndefined()
  })

  it('counts what is missing or expired per active employee for the list and „Was noch fehlt“', () => {
    keepInQualifications()
    for (const name of ['Arbeitsvertrag', 'Erweitertes Führungszeugnis', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Verpflichtung auf den Datenschutz', 'Schweigepflichterklärung']) {
      uploadRequiredDocument(db, actor(traeger), 1, anna, typeId(name), { title: '', documentDate: '2026-01-01', note: '' }, file, NOW)
    }
    uploadRequiredDocument(db, actor(traeger), 1, anna, typeId('Erste-Hilfe-Nachweis'), { title: '', documentDate: '2024-01-01', note: '' }, file, NOW)
    // Someone who left before today does not count.
    db.update(employees).set({ leftOn: '2026-10-31' }).where(eq(employees.id, ben)).run()
    const extras = listEmployeeListExtras(db, 1, TODAY, traeger.permissions)
    expect(extras.find(row => row.employeeId === anna)!.requiredDocuments).toEqual([{ typeId: typeId('Erste-Hilfe-Nachweis'), name: 'Erste-Hilfe-Nachweis', state: 'expired' }])
    expect(extras.find(row => row.employeeId === ben)).toBeUndefined()
    const leitung = addUser(db, 'leitung', 'admin')
    const items = getSetupChecklist(db, traeger, 1, NOW).open.filter(item => item.key === 'employee_required_document')
    expect(items.map(item => [item.label, item.count, item.names.map(named => named.name)])).toEqual([['Erste-Hilfe-Nachweis', 1, ['Anna Probe']]])
    expect(items[0]!.to).toBe(`/admin/employees/${anna}?tab=records`)
    // The Leitung (only the folder Qualifikationen by default) sees only that folder's items.
    const forLeitung = getSetupChecklist(db, leitung, 1, NOW).open.filter(item => item.key === 'employee_required_document')
    expect(forLeitung.map(item => item.label)).toEqual(['Erste-Hilfe-Nachweis'])
    db.update(employees).set({ leftOn: null }).where(eq(employees.id, ben)).run()
    expect(getSetupChecklist(db, leitung, 1, NOW).open.filter(item => item.key === 'employee_required_document').map(item => [item.label, item.count]))
      .toEqual([['Erste-Hilfe-Nachweis', 2], ['Belehrung Infektionsschutz', 1]])
  })

  it('counts a linked document only in its type\'s folder: a moved document or a moved type loses the link', () => {
    const contract = typeId('Arbeitsvertrag')
    const scan = uploadRequiredDocument(db, actor(traeger), 1, anna, contract, { title: '', documentDate: '2026-01-01', note: '' }, file, NOW)
    // The document is moved to Gehalt: unlinked, so nothing of it shows for the Arbeitsvertrag (also not to someone
    // without the key for Gehalt).
    updateEmployeeDocument(db, actor(traeger), 1, scan, { folder: 'salary', title: 'Scan', documentDate: '2026-01-01', note: '' })
    expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.id, scan)).get()!.requiredTypeId).toBeNull()
    expect(employeeRequiredDocuments(db, limited(['employees.docs.contract']), 1, anna, TODAY).find(row => row.typeId === contract))
      .toMatchObject({ state: 'missing', documentId: null, date: null })
    // Same folder, other title: the link stays.
    const kept = uploadRequiredDocument(db, actor(traeger), 1, anna, contract, { title: '', documentDate: '2026-01-01', note: '' }, file, NOW)
    updateEmployeeDocument(db, actor(traeger), 1, kept, { folder: 'contract', title: 'Vertrag 2026', documentDate: '2026-01-01', note: '' })
    expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.id, kept)).get()!.requiredTypeId).toBe(contract)
    // The type is moved to Bewerbung: the documents in Vertrag lose the link; a viewer with only the new folder sees „fehlt“.
    const firstAid = typeId('Erste-Hilfe-Nachweis')
    uploadRequiredDocument(db, actor(traeger), 1, anna, firstAid, { title: '', documentDate: '2026-01-01', note: '' }, file, NOW)
    updateRequiredType(db, actor(traeger), 1, firstAid, input({ name: 'Erste-Hilfe-Nachweis', folder: 'application', validityMonths: 24 }))
    expect(employeeRequiredDocuments(db, limited(['employees.docs.application']), 1, anna, TODAY).find(row => row.typeId === firstAid))
      .toMatchObject({ state: 'missing', documentId: null, date: null })
    expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.requiredTypeId, firstAid)).all()).toEqual([])
    // A link written outside the service to a document of another folder counts nowhere either.
    const stray = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'salary', title: 'Gehalt', documentDate: '2026-02-01', note: '' }, file, NOW)
    db.update(employeeDocuments).set({ requiredTypeId: contract }).where(eq(employeeDocuments.id, stray)).run()
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === contract)).toMatchObject({ documentId: kept })
  })

  it('checks names, order and templates only against what the editor sees', () => {
    keepInQualifications()
    const onlyQualifications = limited(['employees.docs.qualifications'])
    // A hidden type's name is not given away; the visible ones stay unique.
    expect(() => createRequiredType(db, onlyQualifications, 1, input({ name: 'Arbeitsvertrag' }))).not.toThrow()
    expect(errorCode(() => createRequiredType(db, onlyQualifications, 1, input({ name: 'erste-hilfe-nachweis' })))).toBe('required_type_name_taken')
    // ▼ on Belehrung swaps it with Erste-Hilfe (the hidden Datenschutz between them keeps its place).
    moveRequiredType(db, onlyQualifications, 1, typeId('Belehrung Infektionsschutz'), 'down')
    expect(listRequiredTypes(db, onlyQualifications, 1).map(type => type.name).slice(0, 2)).toEqual(['Erste-Hilfe-Nachweis', 'Belehrung Infektionsschutz'])
    expect(listRequiredTypes(db, actor(traeger), 1).map(type => type.name).slice(3, 6))
      .toEqual(['Erste-Hilfe-Nachweis', 'Verpflichtung auf den Datenschutz', 'Belehrung Infektionsschutz'])
    // A template the viewer does not see: no „Ausfüllen“ for them.
    db.delete(templateCategories).run()
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    const managers = createCategory(db, sender, { name: 'Leitung', visibility: 'managers' })
    const template = uploadTemplate(db, sender, { title: 'Belehrung', categoryId: managers, scope: 'facility' }, { data: fillablePdf(), filename: 'b.pdf' }, NOW)
    const belehrung = typeId('Belehrung Infektionsschutz')
    updateRequiredType(db, actor(traeger), 1, belehrung, input({ name: 'Belehrung Infektionsschutz', templateId: template }))
    const row = (viewer: RequiredDocsActor) => employeeRequiredDocuments(db, viewer, 1, anna, TODAY).find(entry => entry.typeId === belehrung)!
    expect(row(actor(traeger)).templateId).toBe(template)
    expect(row({ id: traeger.id, role: 'observer', permissions: new Set<PermissionKey>(['employees.view', 'employees.docs.qualifications']) }).templateId).toBeNull()
  })

  it('refuses another facility\'s type, an inactive type and a file that is no PDF, JPEG or PNG', () => {
    const krippe = createFacility(db, 'Krippe').id
    const foreign = typeId('Arbeitsvertrag', krippe)
    const scan = uploadEmployeeDocument(db, actor(traeger), 1, anna, { folder: 'contract', title: 'Vertrag', documentDate: TODAY, note: '' }, file, NOW)
    expect(errorCode(() => linkRequiredDocument(db, actor(traeger), 1, scan, foreign))).toBe('required_type_not_found')
    expect(errorCode(() => uploadRequiredDocument(db, actor(traeger), 1, anna, foreign, { title: '', documentDate: TODAY, note: '' }, file, NOW)))
      .toBe('required_type_not_found')
    const masern = typeId('Masernnachweis')
    updateRequiredType(db, actor(traeger), 1, masern, input({ name: 'Masernnachweis', folder: 'required', active: false }))
    expect(errorCode(() => uploadRequiredDocument(db, actor(traeger), 1, anna, masern, { title: '', documentDate: TODAY, note: '' }, file, NOW)))
      .toBe('required_type_not_found')
    expect(errorCode(() => uploadRequiredDocument(db, actor(traeger), 1, anna, typeId('Arbeitsvertrag'), { title: '', documentDate: TODAY, note: '' },
      { data: Buffer.from('MZ not a document'), filename: 'x.exe' }, NOW))).toBe('document_type_invalid')
    // „Ausfüllen“: the folder chosen must be the type's.
    expect(errorCode(() => uploadRequiredDocument(db, actor(traeger), 1, anna, typeId('Arbeitsvertrag'), { title: '', documentDate: TODAY, note: '', folder: 'salary' }, file, NOW)))
      .toBe('required_type_folder_mismatch')
    expect(uploadRequiredDocument(db, actor(traeger), 1, anna, typeId('Arbeitsvertrag'), { title: 'Vertrag', documentDate: TODAY, note: '', folder: 'contract' }, file, NOW))
      .toBeGreaterThan(0)
  })

  it('files the signed copy of a request sent „als Pflichtdokument“ as that type', () => {
    db.delete(templateCategories).run()
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    const categoryId = createCategory(db, sender, { name: 'Personal', visibility: 'all' })
    const template = uploadTemplate(db, sender, { title: 'Datenschutz', categoryId, scope: 'facility' }, { data: fillablePdf(), filename: 'd.pdf' }, NOW)
    const privacy = typeId('Verpflichtung auf den Datenschutz')
    const request = (folder: 'required' | 'salary', requiredTypeId: number | null) => createSignRequest(db, sender, {
      title: 'Datenschutz', sourceKind: 'template', sourceId: template, recipientIds: [anna], folder, dueDate: null, note: '', requiredTypeId,
    }, null, NOW)
    expect(errorCode(() => request('salary', privacy))).toBe('required_type_folder_mismatch')
    request('required', privacy)
    const recipient = db.select().from(signRequestRecipients).where(eq(signRequestRecipients.employeeId, anna)).get()!
    const { documentId } = signMyRequest(db, { employeeId: anna, userId: null }, recipient.id, Buffer.concat([fillablePdf(), Buffer.from('% signed\n')]), NOW)
    expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get()).toMatchObject({ folder: 'required', requiredTypeId: privacy })
    expect(employeeRequiredDocuments(db, actor(traeger), 1, anna, TODAY).find(row => row.typeId === privacy)).toMatchObject({ state: 'present', documentId })
    // Another facility's type is refused when sending.
    const krippe = createFacility(db, 'Krippe').id
    expect(errorCode(() => request('required', typeId('Verpflichtung auf den Datenschutz', krippe)))).toBe('required_type_not_found')
  })

  it('files the signed copy without the link when the type moved to another folder or was deleted before signing', () => {
    db.delete(templateCategories).run()
    const sender = { id: traeger.id, role: traeger.role, permissions: traeger.permissions, facilityId: 1 }
    const categoryId = createCategory(db, sender, { name: 'Personal', visibility: 'all' })
    const template = uploadTemplate(db, sender, { title: 'Datenschutz', categoryId, scope: 'facility' }, { data: fillablePdf(), filename: 'd.pdf' }, NOW)
    const privacy = typeId('Verpflichtung auf den Datenschutz')
    const silence = typeId('Schweigepflichterklärung')
    for (const [employeeId, requiredTypeId] of [[anna, privacy], [ben, silence]] as const) {
      createSignRequest(db, sender, {
        title: 'Datenschutz', sourceKind: 'template', sourceId: template, recipientIds: [employeeId], folder: 'required', dueDate: null, note: '', requiredTypeId,
      }, null, NOW)
    }
    updateRequiredType(db, actor(traeger), 1, privacy, input({ name: 'Verpflichtung auf den Datenschutz', folder: 'correspondence' }))
    deleteRequiredType(db, actor(traeger), 1, silence)
    for (const employeeId of [anna, ben]) {
      const recipient = db.select().from(signRequestRecipients).where(eq(signRequestRecipients.employeeId, employeeId)).get()!
      const { documentId } = signMyRequest(db, { employeeId, userId: null }, recipient.id, Buffer.concat([fillablePdf(), Buffer.from('% signed\n')]), NOW)
      expect(db.select().from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get()).toMatchObject({ folder: 'required', requiredTypeId: null })
    }
  })
})
