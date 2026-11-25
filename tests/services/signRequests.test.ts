import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeDocuments, employees, signRequestRecipients, signRequests, templateCategories } from '../../server/db/schema'
import { deleteAssessmentData, deleteEmployeeRow } from '../../server/services/employeeDeletion'
import { listEmployeeDocuments, uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { deleteTemplate, uploadTemplate, type TemplateActor } from '../../server/services/printTemplates'
import {
  createSignRequest, declineMyRequest, deleteSignRequest, listMySignRequests, listSignRequests, mySignRequestCount,
  overdueSignRequestCount, readMySignRequestFile, readSignRequestFile, remindSignRequest, signMyRequest, withdrawSignRequest,
  type SignRequestInput, type SignSender,
} from '../../server/services/signRequests'
import { finishedSignRequests } from '../../server/services/signRequestRecords'
import { deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { createCategory } from '../../server/services/templateCategories'
import { saveRoleBundle } from '../../server/services/permissions'
import type { SessionUser } from '../../shared/types/api'
import { fillablePdf, plainPdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, createTestDb, errorCode, refreshPermissions } from '../helpers/fixtures'
import { openSignHints, openSignPeople } from '../../app/utils/signRequestsOpen'

/**
 * „Zum Unterschreiben senden“: sending from a template or a personnel document, who may send, the employee's own list
 * (own account and the unlocked tablet), signing into the personnel file, declining, reminding, withdrawing, the
 * counts, who sees which request (folders, templates), removing (by the sender, under Löschfristen, with the employee)
 * while keeping the record of a signature. The tablet's sign unlock: tests/services/signUnlock.test.ts.
 */

const TODAY = '2026-11-24'
const NOW = new Date('2026-11-24T09:00:00.000Z')
const LATER = new Date('2026-11-24T10:15:00.000Z')
const sender = (user: SessionUser): SignSender => ({ id: user.id, role: user.role, permissions: user.permissions, facilityId: user.facilityId! })
/** The signed copy: the sent PDF with what pdf.js appends (signature, footer). */
const signed = (marker = 'signed', sent = plainPdf()) => Buffer.concat([sent, Buffer.from(`% ${marker}\n`)])
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const mine = (employeeId: number) => ({ employeeId })
const byAccount = (employeeId: number) => ({ employeeId, userId: null })

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
  /** The signed copy of a template request (the template is fillablePdf()). */
  const signedTemplate = (marker = 'signed') => signed(marker, fillablePdf())

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
    expect(row.fileData!.equals(fillablePdf())).toBe(true)
    expect(row.fileSha256).toBe(sha(fillablePdf()))
    expect(row).toMatchObject({ sourceFolder: null, sourceEmployeeId: null, deletedAt: null })
    expect(db.select().from(signRequestRecipients).all().map(r => [r.employeeId, r.status])).toEqual([[anna, 'open'], [ben, 'open']])
    // Filled in before sending: that PDF goes to everyone.
    const filled = Buffer.concat([fillablePdf(), Buffer.from('% vorausgefüllt\n')])
    const second = createSignRequest(db, leitung, input({ recipientIds: [anna] }), filled, NOW)
    expect(readSignRequestFile(db, leitung, second).data.equals(filled)).toBe(true)
    expect(readMySignRequestFile(db, mine(anna), db.select().from(signRequestRecipients).where(eq(signRequestRecipients.requestId, second)).get()!.id).data.equals(filled)).toBe(true)
  })

  it('sends a personnel document only to its own employee', () => {
    const documentId = uploadEmployeeDocument(db, leitung, 1, anna, { folder: 'qualifications', title: 'Zusatzvereinbarung', documentDate: TODAY, note: '' },
      { data: plainPdf(), filename: 'z.pdf' }, NOW)
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: documentId, recipientIds: [ben] }), null, NOW)))
      .toBe('invalid_recipients')
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: documentId, recipientIds: [anna, ben] }), null, NOW)))
      .toBe('invalid_recipients')
    const id = createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: documentId, recipientIds: [anna] }), null, NOW)
    expect(db.select().from(signRequests).where(eq(signRequests.id, id)).get())
      .toMatchObject({ sourceKind: 'document', sourceDocumentId: documentId, sourceFolder: 'qualifications', sourceEmployeeId: anna })
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
    // Filled in before sending means the template with an update appended, not another PDF.
    expect(errorCode(() => createSignRequest(db, leitung, input(), plainPdf(), NOW))).toBe('signed_file_mismatch')
    expect(errorCode(() => createSignRequest(db, leitung, input({ sourceId: 9999 }), null, NOW))).toBe('print_template_not_found')
    // Without the switch, even the Leitung may not send.
    saveRoleBundle(db, 'admin', 'signRequests', false)
    expect(errorCode(() => createSignRequest(db, sender(refreshPermissions(db, addUser(db, 'leitung2', 'admin'))), input(), null, NOW))).toBe('forbidden')
  })

  it('shows the employee only their own open requests, with the count, overdue first', () => {
    createSignRequest(db, leitung, input({ title: 'Erste', dueDate: '2026-12-15' }), null, NOW)
    createSignRequest(db, leitung, input({ title: 'Zweite', dueDate: '2026-11-20', recipientIds: [anna] }), null, NOW)
    const list = listMySignRequests(db, mine(anna), TODAY)
    expect(list.employeeName).toBe('Anna Probe')
    expect(list.requests.map(request => [request.title, request.overdue, request.sentBy])).toEqual([['Zweite', true, 'leitung'], ['Erste', false, 'leitung']])
    expect(mySignRequestCount(db, anna, TODAY)).toEqual({ count: 2, overdue: 1 })
    expect(mySignRequestCount(db, ben, TODAY)).toEqual({ count: 1, overdue: 0 })
    expect(overdueSignRequestCount(db, leitung, TODAY)).toBe(1)
    // Another person's request is not found.
    const bensRecipient = recipientOf(ben).id
    expect(errorCode(() => readMySignRequestFile(db, mine(anna), bensRecipient))).toBe('sign_request_not_found')
    expect(errorCode(() => signMyRequest(db, byAccount(anna), bensRecipient, signedTemplate(), LATER))).toBe('sign_request_not_found')
    expect(errorCode(() => declineMyRequest(db, { employeeId: anna, userId: null }, bensRecipient, 'nein', LATER))).toBe('sign_request_not_found')
  })

  it('stores the signed copy in the request\'s folder of the personnel file, with title, uploader and SHA-256', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    const account = addUser(db, 'anna', 'observer', anna)
    const recipientId = recipientOf(anna).id
    const file = signedTemplate()
    const result = signMyRequest(db, byAccount(anna), recipientId, file, LATER)
    expect(result.sha256).toBe(sha(file))
    const document = db.select().from(employeeDocuments).where(eq(employeeDocuments.id, result.documentId)).get()!
    // At the tablet the person's own account is named as uploader.
    expect(document).toMatchObject({ employeeId: anna, folder: 'qualifications', title: 'Belehrung § 34 IfSG – unterschrieben am 24.11.2026',
      documentDate: TODAY, mimeType: 'application/pdf', uploadedBy: account.id, uploadedAt: LATER.toISOString(), size: file.length })
    expect(document.data.equals(file)).toBe(true)
    expect(recipientOf(anna)).toMatchObject({ status: 'signed', signedAt: LATER.toISOString(), signedDocumentId: result.documentId, signedHash: result.sha256 })
    expect(mySignRequestCount(db, anna).count).toBe(0)
    expect(listEmployeeDocuments(db, leitung, 1, anna).qualifications!.map(doc => [doc.title, doc.uploadedBy])).toEqual([[document.title, 'anna']])
    // Signed is signed: no second time, no decline.
    expect(errorCode(() => signMyRequest(db, { employeeId: anna, userId: account.id }, recipientId, file, LATER))).toBe('sign_request_closed')
    expect(errorCode(() => declineMyRequest(db, { employeeId: anna, userId: account.id }, recipientId, 'doch nicht', LATER))).toBe('sign_request_closed')
    expect(errorCode(() => readMySignRequestFile(db, mine(anna), recipientId))).toBe('sign_request_closed')
  })

  it('accepts as the signed copy only the sent PDF with an update appended', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    const recipientId = recipientOf(anna).id
    expect(errorCode(() => signMyRequest(db, byAccount(anna), recipientId, Buffer.from('<html>'), LATER))).toBe('document_type_invalid')
    // Another PDF, the sent one unchanged, or one cut short is no signed copy of it.
    for (const file of [signed('other', plainPdf()), fillablePdf(), fillablePdf().subarray(0, 200),
      Buffer.concat([Buffer.from('%PDF-1.7\n% vorne\n'), fillablePdf()])]) {
      expect(errorCode(() => signMyRequest(db, byAccount(anna), recipientId, file, LATER))).toMatch(/signed_file_mismatch|document_type_invalid/)
    }
    expect(errorCode(() => signMyRequest(db, byAccount(anna), recipientId, signed('other', plainPdf()), LATER))).toBe('signed_file_mismatch')
    expect(recipientOf(anna).status).toBe('open')
    expect(db.select().from(employeeDocuments).all()).toEqual([])
  })

  it('declines with a reason of at most 300 characters', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    const recipientId = recipientOf(anna).id
    for (const reason of ['', '   ', 'x'.repeat(301)]) {
      expect(errorCode(() => declineMyRequest(db, byAccount(anna), recipientId, reason, LATER))).toBe('decline_reason_required')
    }
    declineMyRequest(db, byAccount(anna), recipientId, '  Der Text stimmt nicht.  ', LATER)
    expect(recipientOf(anna)).toMatchObject({ status: 'declined', declinedAt: LATER.toISOString(), declineReason: 'Der Text stimmt nicht.' })
    expect(db.select().from(employeeDocuments).all()).toEqual([])
  })

  it('lists the requests for the senders with every recipient, reminds and withdraws the open ones', () => {
    const id = createSignRequest(db, leitung, input(), null, NOW)
    signMyRequest(db, byAccount(anna), recipientOf(anna).id, signedTemplate(), LATER)
    const [request] = listSignRequests(db, leitung, '2026-12-01')
    expect(request).toMatchObject({ id, title: 'Belehrung § 34 IfSG', createdBy: 'leitung', overdue: true, targetFolder: 'qualifications' })
    expect(request!.recipients.map(r => [r.name, r.status, r.signedDocumentId !== null])).toEqual([['Anna Probe', 'signed', true], ['Ben Beispiel', 'open', false]])
    expect(listSignRequests(db, leitung, TODAY)[0]!.overdue).toBe(false)

    expect(remindSignRequest(db, leitung, id, null, LATER)).toBe(1)
    expect(recipientOf(ben).remindedAt).toBe(LATER.toISOString())
    expect(recipientOf(anna).remindedAt).toBeNull()
    expect(listMySignRequests(db, mine(ben), TODAY).requests[0]!.remindedAt).toBe(LATER.toISOString())
    // A signed one can be neither reminded nor withdrawn.
    expect(errorCode(() => remindSignRequest(db, leitung, id, recipientOf(anna).id, LATER))).toBe('sign_request_closed')
    expect(withdrawSignRequest(db, leitung, id, null, LATER)).toBe(1)
    expect(recipientOf(ben)).toMatchObject({ status: 'withdrawn', withdrawnAt: LATER.toISOString() })
    expect(mySignRequestCount(db, ben).count).toBe(0)
    expect(errorCode(() => withdrawSignRequest(db, leitung, id, null, LATER))).toBe('sign_request_closed')
  })

  it('shows a request only to senders who may use its folders and see its template; keeps every facility to its own', () => {
    const traeger = sender(addUser(db, 'traeger', 'provider'))
    // Into „Vertrag“: the Leitung (without that folder by default) sees neither the request nor its PDF.
    const contract = createSignRequest(db, traeger, input({ recipientIds: [anna], folder: 'contract' }), null, NOW)
    // From a personnel document in „Gehalt“ into „Schriftverkehr“: the folder it came from counts as well.
    const payslip = uploadEmployeeDocument(db, traeger, 1, anna, { folder: 'salary', title: 'Gehaltsänderung', documentDate: TODAY, note: '' },
      { data: plainPdf(), filename: 'g.pdf' }, NOW)
    const fromSalary = createSignRequest(db, traeger, input({ sourceKind: 'document', sourceId: payslip, recipientIds: [anna], folder: 'correspondence' }), null, NOW)
    // From a template only the Träger sees.
    const providerCategory = createCategory(db, { ...traeger }, { name: 'Träger intern', visibility: 'provider' })
    const internal = uploadTemplate(db, { ...traeger }, { title: 'Intern', categoryId: providerCategory, scope: 'facility' },
      { data: fillablePdf(), filename: 'Intern.pdf' }, NOW)
    const fromInternal = createSignRequest(db, traeger, input({ sourceId: internal, recipientIds: [ben] }), null, NOW)
    const visible = createSignRequest(db, traeger, input({ recipientIds: [ben], title: 'Für alle' }), null, NOW)
    expect(listSignRequests(db, traeger, TODAY).map(request => request.id).sort()).toEqual([contract, fromSalary, fromInternal, visible].sort())
    expect(listSignRequests(db, leitung, TODAY).map(request => request.id)).toEqual([visible])
    for (const id of [contract, fromSalary, fromInternal]) {
      for (const action of [() => readSignRequestFile(db, leitung, id), () => remindSignRequest(db, leitung, id, null, LATER),
        () => withdrawSignRequest(db, leitung, id, null, LATER), () => deleteSignRequest(db, leitung, id)]) {
        expect(errorCode(action), String(id)).toBe('sign_request_not_found')
      }
    }
    // The template's visibility where it showed is kept; once the template is deleted, that still decides.
    expect(db.select({ v: signRequests.sourceVisibility }).from(signRequests).where(eq(signRequests.id, fromInternal)).get()).toEqual({ v: 'provider' })
    expect(db.select({ v: signRequests.sourceVisibility }).from(signRequests).where(eq(signRequests.id, visible)).get()).toEqual({ v: 'all' })
    deleteTemplate(db, { ...traeger }, internal)
    expect(db.select({ t: signRequests.sourceTemplateId }).from(signRequests).where(eq(signRequests.id, fromInternal)).get()).toEqual({ t: null })
    expect(listSignRequests(db, leitung, TODAY).map(request => request.id)).toEqual([visible])
    expect(errorCode(() => readSignRequestFile(db, leitung, fromInternal))).toBe('sign_request_not_found')
    expect(listSignRequests(db, traeger, TODAY).map(request => request.id)).toContain(fromInternal)
    // Overdue ones count only where they are seen.
    expect(overdueSignRequestCount(db, traeger, '2026-12-01')).toBe(4)
    expect(overdueSignRequestCount(db, leitung, '2026-12-01')).toBe(1)
    // Another facility sees none of them.
    const krippe = addFacility(db, 'Krippe')
    const otherLeitung = sender(addUser(db, 'leitung-krippe', 'admin', null, krippe))
    expect(listSignRequests(db, otherLeitung, TODAY)).toEqual([])
    expect(errorCode(() => readSignRequestFile(db, otherLeitung, visible))).toBe('sign_request_not_found')
  })

  it('builds „Wer muss noch unterschreiben?“ and the list hints only from the requests the viewer sees (folders, facility)', () => {
    const traeger = sender(addUser(db, 'traeger', 'provider'))
    // Into „Vertrag“ (the Leitung has no such folder by default): Anna's open request is the Träger's business only.
    createSignRequest(db, traeger, input({ recipientIds: [anna], folder: 'contract', title: 'Vertrag' }), null, NOW)
    const forAll = createSignRequest(db, traeger, input({ recipientIds: [anna, ben], title: 'Für alle', dueDate: '2026-11-20' }), null, NOW)
    signMyRequest(db, byAccount(ben), db.select().from(signRequestRecipients).where(eq(signRequestRecipients.requestId, forAll)).all()
      .find(row => row.employeeId === ben)!.id, signedTemplate(), LATER)
    const people = (viewer: SignSender) => openSignPeople(listSignRequests(db, viewer, TODAY), TODAY)
      .map(person => [person.name, person.items.map(item => [item.request.title, item.overdue])])
    expect(people(traeger)).toEqual([['Anna Probe', [['Für alle', true], ['Vertrag', false]]]])
    expect(people(leitung)).toEqual([['Anna Probe', [['Für alle', true]]]])
    expect([...openSignHints(listSignRequests(db, leitung, TODAY), TODAY)]).toEqual([[anna, { count: 1, overdue: 1, color: 'error' }]])
    // Another facility sees nobody; signed, declined and withdrawn ones are not open.
    const otherLeitung = sender(addUser(db, 'leitung-krippe', 'admin', null, addFacility(db, 'Krippe')))
    expect(people(otherLeitung)).toEqual([])
    withdrawSignRequest(db, traeger, forAll, null, LATER)
    expect(people(leitung)).toEqual([])
  })

  it('links the signed copy only for a viewer who may use the folder it is in now; marks it changed or deleted', () => {
    createSignRequest(db, leitung, input({ recipientIds: [anna, ben] }), null, NOW)
    const { documentId } = signMyRequest(db, byAccount(anna), recipientOf(anna).id, signedTemplate(), LATER)
    const { documentId: bensCopy } = signMyRequest(db, byAccount(ben), recipientOf(ben).id, signedTemplate('ben'), LATER)
    const recipients = () => listSignRequests(db, leitung, TODAY)[0]!.recipients.map(recipient => ({
      name: recipient.name, linked: recipient.signedDocumentId !== null, modified: recipient.copyModified, deleted: recipient.copyDeleted,
    }))
    expect(recipients()).toEqual([
      { name: 'Anna Probe', linked: true, modified: false, deleted: false }, { name: 'Ben Beispiel', linked: true, modified: false, deleted: false },
    ])
    // Anna's copy moved to „Gehalt“ and replaced by another file; Ben's deleted.
    db.update(employeeDocuments).set({ folder: 'salary', data: plainPdf(), uploadedAt: '2026-11-25T08:00:00.000Z' })
      .where(eq(employeeDocuments.id, documentId)).run()
    db.delete(employeeDocuments).where(eq(employeeDocuments.id, bensCopy)).run()
    expect(recipients()).toEqual([
      { name: 'Anna Probe', linked: false, modified: true, deleted: false }, { name: 'Ben Beispiel', linked: false, modified: false, deleted: true },
    ])
    // Uploaded again with the same file: not changed.
    db.update(employeeDocuments).set({ data: signedTemplate() }).where(eq(employeeDocuments.id, documentId)).run()
    expect(recipients()[0]).toMatchObject({ modified: false })
  })

  it('removes a request with its PDF; the records of signatures and declines stay, the signed copies in the personnel file', () => {
    const id = createSignRequest(db, leitung, input({ recipientIds: [anna, ben] }), null, NOW)
    const { documentId } = signMyRequest(db, byAccount(anna), recipientOf(anna).id, signedTemplate(), LATER)
    deleteSignRequest(db, leitung, id, LATER)
    expect(db.select().from(signRequests).all()).toEqual([expect.objectContaining({
      id, fileData: null, fileSha256: sha(fillablePdf()), deletedAt: LATER.toISOString(),
    })])
    // Ben (open) no longer has to sign; Anna's record stays.
    expect(db.select().from(signRequestRecipients).all().map(r => [r.employeeId, r.status, r.signedHash])).toEqual([[anna, 'signed', sha(signedTemplate())]])
    expect(mySignRequestCount(db, ben).count).toBe(0)
    expect(listSignRequests(db, leitung, TODAY)).toEqual([])
    expect(errorCode(() => readSignRequestFile(db, leitung, id))).toBe('sign_request_not_found')
    expect(errorCode(() => deleteSignRequest(db, leitung, id))).toBe('sign_request_not_found')
    expect(db.select({ id: employeeDocuments.id }).from(employeeDocuments).all()).toEqual([{ id: documentId }])
    // Nobody signed: the request goes entirely.
    const unsigned = createSignRequest(db, leitung, input({ recipientIds: [ben] }), null, NOW)
    deleteSignRequest(db, leitung, unsigned, LATER)
    expect(db.select({ id: signRequests.id }).from(signRequests).all()).toEqual([{ id }])
    // The record goes with „Beurteilungen und Zeugnisse“, then the request row.
    db.transaction(tx => deleteAssessmentData(tx, anna))
    expect(db.select().from(signRequests).all()).toEqual([])
  })

  it('goes with the employee: their recipient rows, not the request of the others; the PDFs sent from their file', () => {
    createSignRequest(db, leitung, input(), null, NOW)
    const fromFile = uploadEmployeeDocument(db, leitung, 1, anna, { folder: 'qualifications', title: 'Zusatz', documentDate: TODAY, note: '' },
      { data: plainPdf(), filename: 'z.pdf' }, NOW)
    createSignRequest(db, leitung, input({ sourceKind: 'document', sourceId: fromFile, recipientIds: [anna] }), null, NOW)
    db.transaction(tx => deleteEmployeeRow(tx, anna))
    expect(db.select().from(employees).where(eq(employees.id, anna)).all()).toEqual([])
    expect(db.select().from(signRequestRecipients).all().map(r => r.employeeId)).toEqual([ben])
    expect(db.select({ title: signRequests.title, sourceKind: signRequests.sourceKind }).from(signRequests).all())
      .toEqual([{ title: 'Belehrung § 34 IfSG', sourceKind: 'template' }])
    expect(mySignRequestCount(db, ben).count).toBe(1)
  })

  it('lists finished requests under Löschfristen from one year after the last recipient finished; the Träger deletes them there', () => {
    const traeger = refreshPermissions(db, addUser(db, 'traeger', 'provider'))
    const done = createSignRequest(db, leitung, input(), null, NOW)
    signMyRequest(db, byAccount(anna), recipientOf(anna).id, signedTemplate(), LATER)
    declineMyRequest(db, byAccount(ben), recipientOf(ben).id, 'nein', LATER)
    createSignRequest(db, leitung, input({ recipientIds: [anna] }), null, NOW)
    expect(finishedSignRequests(db)).toEqual([{ id: done, facilityId: 1, title: 'Belehrung § 34 IfSG', deletableFrom: '2027-11-24' }])
    const item = (today: string) => retentionOverview(db, today).find(entry => entry.kind === 'signRequest')
    expect(item('2027-11-23')).toMatchObject({ key: `signRequest:${done}`, name: 'Belehrung § 34 IfSG', due: false, deletableFrom: '2027-11-24' })
    expect(item('2027-11-24')).toMatchObject({ due: true })
    // Nothing is deleted by itself; the Träger deletes it, the records stay.
    deleteRetentionItem(db, traeger, `signRequest:${done}`, '2027-11-24', new Date('2027-11-24T10:00:00.000Z'))
    expect(item('2027-11-24')).toBeUndefined()
    expect(db.select({ id: signRequests.id, fileData: signRequests.fileData }).from(signRequests).where(eq(signRequests.id, done)).get())
      .toEqual({ id: done, fileData: null })
    expect(db.select().from(signRequestRecipients).where(eq(signRequestRecipients.requestId, done)).all()).toHaveLength(2)
    expect(db.select().from(employeeDocuments).all()).toHaveLength(1)
  })
})
