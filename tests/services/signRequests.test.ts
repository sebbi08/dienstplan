import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeDocuments, employees, signRequestRecipients, signRequests, templateCategories } from '../../server/db/schema'
import { deleteEmployeeRow } from '../../server/services/employeeDeletion'
import { listEmployeeDocuments, uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { uploadTemplate, type TemplateActor } from '../../server/services/printTemplates'
import {
  createSignRequest, declineMyRequest, deleteExpiredSignRequests, deleteSignRequest, listMySignRequests, listSignRequests,
  mySignRequestCount, readMySignRequestFile, readSignRequestFile, remindSignRequest, signMyRequest, withdrawSignRequest,
  type SignRequestInput, type SignSender,
} from '../../server/services/signRequests'
import { createCategory } from '../../server/services/templateCategories'
import { saveRoleBundle } from '../../server/services/permissions'
import type { SessionUser } from '../../shared/types/api'
import { fillablePdf, plainPdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, createTestDb, errorCode, refreshPermissions } from '../helpers/fixtures'

/**
 * „Zum Unterschreiben senden“: sending from a template or a personnel document, who may send, the employee's own list
 * (own account and the unlocked tablet), signing into the personnel file, declining, reminding, withdrawing, the
 * counts, deleting with the employee and after a year.
 */

const TODAY = '2026-11-24'
const NOW = new Date('2026-11-24T09:00:00.000Z')
const LATER = new Date('2026-11-24T10:15:00.000Z')
const sender = (user: SessionUser): SignSender => ({ id: user.id, role: user.role, permissions: user.permissions, facilityId: user.facilityId! })
/** The signed copy: the sent PDF with what pdf.js appends (signature, footer). */
const signed = (marker = 'signed') => Buffer.concat([plainPdf(), Buffer.from(`% ${marker}\n`)])

describe('requests to sign', () => {
  let db: Db
  let leitung: SignSender
  let anna: number
  let ben: number
  let templateId: number

  beforeEach(() => {
    db = createTestDb()
    const admin = addUser(db, 'leitung', 'admin')
    leitung = sender(admin)
    anna = addEmployee(db, 'Anna Probe')
    ben = addEmployee(db, 'Ben Beispiel')
    db.delete(templateCategories).run()
    const templateActor: TemplateActor = { ...leitung }
    const categoryId = createCategory(db, templateActor, { name: 'Personal', visibility: 'all' })
    templateId = uploadTemplate(db, templateActor, { title: 'Belehrung', categoryId, scope: 'facility' },
      { data: fillablePdf(), filename: 'Belehrung.pdf' }, NOW)
  })

  const input = (overrides: Partial<SignRequestInput> = {}): SignRequestInput => ({
    title: 'Belehrung § 34 IfSG', sourceKind: 'template', sourceId: templateId, recipientIds: [anna, ben], folder: 'qualifications',
    dueDate: '2026-11-30', note: 'Bitte bis Monatsende.', ...overrides,
  })
  const recipientOf = (employeeId: number) =>
    db.select().from(signRequestRecipients).where(eq(signRequestRecipients.employeeId, employeeId)).get()!

  it('sends a template (as it is, or filled in before) to several employees, one recipient each', () => {
    const id = createSignRequest(db, leitung, input(), null, NOW)
    const row = db.select().from(signRequests).where(eq(signRequests.id, id)).get()!
    expect(row).toMatchObject({ facilityId: 1, createdBy: leitung.id, title: 'Belehrung § 34 IfSG', sourceKind: 'template',
      sourceTemplateId: templateId, targetFolder: 'qualifications', dueDate: '2026-11-30', note: 'Bitte bis Monatsende.' })
    expect(row.fileData.equals(fillablePdf())).toBe(true)
    expect(db.select().from(signRequestRecipients).all().map(r => [r.employeeId, r.status])).toEqual([[anna, 'open'], [ben, 'open']])
    // Filled in before sending: that PDF goes to everyone.
    const filled = Buffer.concat([fillablePdf(), Buffer.from('% vorausgefüllt\n')])
    const second = createSignRequest(db, leitung, input({ recipientIds: [anna] }), filled, NOW)
    expect(readSignRequestFile(db, leitung, second).data.equals(filled)).toBe(true)
    expect(readMySignRequestFile(db, anna, db.select().from(signRequestRecipients).where(eq(signRequestRecipients.requestId, second)).get()!.id).data.equals(filled)).toBe(true)
  })

  it('sends a personnel document only to its own employee', () => {
    const documentId = uploadEmployeeDocument(db, leitung, 1, anna, { folder: 'qualifications', title: 'Zusatzvereinbarung', documentDate: TODAY, note: '' },
      { data: plainPdf(), filename: 'z.pdf' }, NOW)
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: documentId, recipientIds: [ben] }), null, NOW)))
      .toBe('invalid_recipients')
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: documentId, recipientIds: [anna, ben] }), null, NOW)))
      .toBe('invalid_recipients')
    const id = createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: documentId, recipientIds: [anna] }), null, NOW)
    expect(db.select().from(signRequests).where(eq(signRequests.id, id)).get()).toMatchObject({ sourceKind: 'document', sourceDocumentId: documentId })
    // A picture is no document to sign.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])
    const picture = uploadEmployeeDocument(db, leitung, 1, anna, { folder: 'qualifications', title: 'Foto', documentDate: TODAY, note: '' },
      { data: png, filename: 'f.png' }, NOW)
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: picture, recipientIds: [anna] }), null, NOW)))
      .toBe('document_type_invalid')
  })

  it('checks who may send, the folder, the recipients and the file', () => {
    const mitarbeiter = sender(addUser(db, 'anna', 'observer', anna))
    expect(errorCode(() => createSignRequest(db, mitarbeiter, input(), null, NOW))).toBe('forbidden')
    // The Leitung may not use the folder „Gehalt“ by default.
    expect(errorCode(() => createSignRequest(db, leitung, input({ folder: 'salary' }), null, NOW))).toBe('forbidden')
    const left = addEmployee(db, 'Cora Gegangen', { leftOn: '2026-10-31' })
    const elsewhere = addEmployee(db, 'Dora Krippe', { facilityId: addFacility(db, 'Krippe') })
    for (const recipientIds of [[left], [elsewhere], [9999], []]) {
      expect(errorCode(() => createSignRequest(db, leitung, input({ recipientIds }), null, NOW)), String(recipientIds)).toBe('invalid_recipients')
    }
    // Leaving later: still staff.
    const leaving = addEmployee(db, 'Eva Bald', { leftOn: '2026-12-31' })
    expect(errorCode(() => createSignRequest(db, leitung, input({ recipientIds: [leaving] }), null, NOW))).toBeNull()
    expect(errorCode(() => createSignRequest(db, leitung, input({ title: '  ' }), null, NOW))).toBe('invalid_input')
    expect(errorCode(() => createSignRequest(db, leitung, input({ dueDate: '2026-02-30' }), null, NOW))).toBe('invalid_date')
    expect(errorCode(() => createSignRequest(db, leitung, input(), Buffer.from('kein pdf'), NOW))).toBe('document_type_invalid')
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceId: 9999 }), null, NOW))).toBe('print_template_not_found')
    // Without the switch, even the Leitung may not send.
    saveRoleBundle(db, 'admin', 'signRequests', false)
    expect(errorCode(() => createSignRequest(db, sender(refreshPermissions(db, addUser(db, 'leitung2', 'admin'))), input(), null, NOW))).toBe('forbidden')
  })

  it('shows the employee only their own open requests, with the count, overdue first', () => {
    createSignRequest(db, leitung, input({ title: 'Erste', dueDate: '2026-12-15' }), null, NOW)
    createSignRequest(db, leitung, input({ title: 'Zweite', dueDate: '2026-11-20', recipientIds: [anna] }), null, NOW)
    const mine = listMySignRequests(db, anna, TODAY)
    expect(mine.employeeName).toBe('Anna Probe')
    expect(mine.requests.map(request => [request.title, request.overdue, request.sentBy])).toEqual([['Zweite', true, 'leitung'], ['Erste', false, 'leitung']])
    expect(mySignRequestCount(db, anna)).toBe(2)
    expect(mySignRequestCount(db, ben)).toBe(1)
    // Another person's request is not found.
    const bensRecipient = recipientOf(ben).id
    expect(errorCode(() => readMySignRequestFile(db, anna, bensRecipient))).toBe('sign_request_not_found')
    expect(errorCode(() => signMyRequest(db, { employeeId: anna, userId: null }, bensRecipient, signed(), LATER))).toBe('sign_request_not_found')
    expect(errorCode(() => declineMyRequest(db, { employeeId: anna, userId: null }, bensRecipient, 'nein', LATER))).toBe('sign_request_not_found')
  })

  it('stores the signed copy in the request\'s folder of the personnel file, with title, uploader and SHA-256', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    const account = addUser(db, 'anna', 'observer', anna)
    const recipientId = recipientOf(anna).id
    const file = signed()
    const result = signMyRequest(db, { employeeId: anna, userId: null }, recipientId, file, LATER)
    expect(result.sha256).toBe(createHash('sha256').update(file).digest('hex'))
    const document = db.select().from(employeeDocuments).where(eq(employeeDocuments.id, result.documentId)).get()!
    // At the tablet the person's own account is named as uploader.
    expect(document).toMatchObject({ employeeId: anna, folder: 'qualifications', title: 'Belehrung § 34 IfSG – unterschrieben am 24.11.2026',
      documentDate: TODAY, mimeType: 'application/pdf', uploadedBy: account.id, uploadedAt: LATER.toISOString(), size: file.length })
    expect(document.data.equals(file)).toBe(true)
    expect(recipientOf(anna)).toMatchObject({ status: 'signed', signedAt: LATER.toISOString(), signedDocumentId: result.documentId, signedHash: result.sha256 })
    expect(mySignRequestCount(db, anna)).toBe(0)
    expect(listEmployeeDocuments(db, leitung, 1, anna).qualifications!.map(doc => [doc.title, doc.uploadedBy])).toEqual([[document.title, 'anna']])
    // Signed is signed: no second time, no decline.
    expect(errorCode(() => signMyRequest(db, { employeeId: anna, userId: account.id }, recipientId, file, LATER))).toBe('sign_request_closed')
    expect(errorCode(() => declineMyRequest(db, { employeeId: anna, userId: account.id }, recipientId, 'doch nicht', LATER))).toBe('sign_request_closed')
    expect(errorCode(() => readMySignRequestFile(db, anna, recipientId))).toBe('sign_request_closed')
  })

  it('accepts only a PDF as the signed copy', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    expect(errorCode(() => signMyRequest(db, { employeeId: anna, userId: null }, recipientOf(anna).id, Buffer.from('<html>'), LATER)))
      .toBe('document_type_invalid')
    expect(recipientOf(anna).status).toBe('open')
  })

  it('declines with a reason of at most 300 characters', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    const recipientId = recipientOf(anna).id
    for (const reason of ['', '   ', 'x'.repeat(301)]) {
      expect(errorCode(() => declineMyRequest(db, { employeeId: anna, userId: null }, recipientId, reason, LATER))).toBe('decline_reason_required')
    }
    declineMyRequest(db, { employeeId: anna, userId: null }, recipientId, '  Der Text stimmt nicht.  ', LATER)
    expect(recipientOf(anna)).toMatchObject({ status: 'declined', declinedAt: LATER.toISOString(), declineReason: 'Der Text stimmt nicht.' })
    expect(db.select().from(employeeDocuments).all()).toEqual([])
  })

  it('lists the requests for the senders with every recipient, reminds and withdraws the open ones', () => {
    const id = createSignRequest(db, leitung, input(), null, NOW)
    signMyRequest(db, { employeeId: anna, userId: null }, recipientOf(anna).id, signed(), LATER)
    const [request] = listSignRequests(db, leitung, '2026-12-01')
    expect(request).toMatchObject({ id, title: 'Belehrung § 34 IfSG', createdBy: 'leitung', overdue: true, targetFolder: 'qualifications' })
    expect(request!.recipients.map(r => [r.name, r.status, r.signedDocumentId !== null])).toEqual([['Anna Probe', 'signed', true], ['Ben Beispiel', 'open', false]])
    expect(listSignRequests(db, leitung, TODAY)[0]!.overdue).toBe(false)

    expect(remindSignRequest(db, leitung, id, null, LATER)).toBe(1)
    expect(recipientOf(ben).remindedAt).toBe(LATER.toISOString())
    expect(recipientOf(anna).remindedAt).toBeNull()
    expect(listMySignRequests(db, ben, TODAY).requests[0]!.remindedAt).toBe(LATER.toISOString())
    // A signed one can be neither reminded nor withdrawn.
    expect(errorCode(() => remindSignRequest(db, leitung, id, recipientOf(anna).id, LATER))).toBe('sign_request_closed')
    expect(withdrawSignRequest(db, leitung, id, null, LATER)).toBe(1)
    expect(recipientOf(ben)).toMatchObject({ status: 'withdrawn', withdrawnAt: LATER.toISOString() })
    expect(mySignRequestCount(db, ben)).toBe(0)
    expect(errorCode(() => withdrawSignRequest(db, leitung, id, null, LATER))).toBe('sign_request_closed')
  })

  it('links the signed copy only for a viewer who may use its folder; keeps every facility to its own requests, and the Träger may send into every folder', () => {
    const traeger = sender(addUser(db, 'traeger', 'provider'))
    const id = createSignRequest(db, traeger, input({ recipientIds: [anna], folder: 'contract' }), null, NOW)
    signMyRequest(db, { employeeId: anna, userId: null }, recipientOf(anna).id, signed(), LATER)
    expect(listSignRequests(db, traeger, TODAY)[0]!.recipients[0]!.signedDocumentId).not.toBeNull()
    // The Leitung sees the request, but not the signed copy in „Vertrag“.
    expect(listSignRequests(db, leitung, TODAY)[0]!.recipients[0]!.signedDocumentId).toBeNull()
    const krippe = addFacility(db, 'Krippe')
    const otherLeitung = sender(addUser(db, 'leitung-krippe', 'admin', null, krippe))
    expect(listSignRequests(db, otherLeitung, TODAY)).toEqual([])
    for (const action of [() => readSignRequestFile(db, otherLeitung, id), () => remindSignRequest(db, otherLeitung, id, null, LATER),
      () => withdrawSignRequest(db, otherLeitung, id, null, LATER), () => deleteSignRequest(db, otherLeitung, id)]) {
      expect(errorCode(action)).toBe('sign_request_not_found')
    }
  })

  it('deletes a request with its PDF; the signed copies stay in the personnel file', () => {
    const id = createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    const { documentId } = signMyRequest(db, { employeeId: anna, userId: null }, recipientOf(anna).id, signed(), LATER)
    deleteSignRequest(db, leitung, id)
    expect(db.select().from(signRequests).all()).toEqual([])
    expect(db.select().from(signRequestRecipients).all()).toEqual([])
    expect(db.select({ id: employeeDocuments.id }).from(employeeDocuments).all()).toEqual([{ id: documentId }])
  })

  it('goes with the employee: their recipient rows, not the request of the others', () => {
    createSignRequest(db, leitung, input(), null, NOW)
    db.transaction(tx => deleteEmployeeRow(tx, anna))
    expect(db.select().from(employees).where(eq(employees.id, anna)).all()).toEqual([])
    expect(db.select().from(signRequestRecipients).all().map(r => r.employeeId)).toEqual([ben])
    expect(mySignRequestCount(db, ben)).toBe(1)
  })

  it('deletes requests one year after the last recipient finished, not before and never while one is open', () => {
    const done = createSignRequest(db, leitung, input(), null, NOW)
    signMyRequest(db, { employeeId: anna, userId: null }, recipientOf(anna).id, signed(), LATER)
    declineMyRequest(db, { employeeId: ben, userId: null }, recipientOf(ben).id, 'nein', LATER)
    const open = createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    expect(deleteExpiredSignRequests(db, new Date('2027-11-24T09:00:00.000Z'))).toBe(0)
    expect(deleteExpiredSignRequests(db, new Date('2027-11-25T11:00:00.000Z'))).toBe(1)
    expect(db.select({ id: signRequests.id }).from(signRequests).all()).toEqual([{ id: open }])
    expect(done).not.toBe(open)
    // The signed copy stays.
    expect(db.select().from(employeeDocuments).all()).toHaveLength(1)
  })
})
