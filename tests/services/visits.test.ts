import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  applicantVisitDays, applicantVisits, childDocuments, children, employeeDocuments, employees, forms, infoVisits, visitDocuments,
} from '../../server/db/schema'
import { listContacts } from '../../server/services/childContacts'
import { getChildForm, listChildForms, saveChildForm } from '../../server/services/childForms'
import { categoryHasData, deleteAssessmentData, deleteImmediateData, deletePaidOvertimeData } from '../../server/services/employeeDeletion'
import { createTemplate, updateTemplate } from '../../server/services/formTemplates'
import { saveRoleBundle } from '../../server/services/permissions'
import { deleteRetentionItem, retentionOverview } from '../../server/services/retentionOverview'
import { setRetentionSettings } from '../../server/services/retentionSettings'
import {
  createApplicant, createInfoVisit, createVisitForm, deleteApplicant, deleteInfoVisit, deleteVisitDocument, getApplicant, getInfoVisit,
  getVisitForm, hireApplicant, listApplicants, listApplicationForms, listInfoVisits, readVisitDocumentFile, replaceVisitDocumentFile,
  saveVisitForm, takeOverInfoVisit, updateApplicant, updateInfoVisit, uploadVisitDocument, type VisitActor,
} from '../../server/services/visits'
import { RETENTION_DEFAULTS } from '../../shared/domain/retention'
import type { SessionUser } from '../../shared/types/api'
import { fillablePdf, plainPdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, asChildViewer, createTestDb, documentTypeId, errorCode, refreshPermissions } from '../helpers/fixtures'

/**
 * „Infogespräche & Hospitationen“: CRUD and checks, documents (type sniffing, limit, fillable flag), forms of the kinds
 * info and applicant, „Als Vormerkung übernehmen“, „Einstellen“, „Absagen“, the retention items and their deletion,
 * rights and facility isolation, and the employee deletion categories of the moved data.
 */

const NOW = new Date('2026-11-25T09:00:00.000Z')
const LATER = new Date('2026-11-25T10:00:00.000Z')
const actorOf = (user: SessionUser): VisitActor => ({ ...user, facilityId: user.facilityId ?? 1 })

const infoInput = {
  visitDate: '2026-11-20', visitStart: 600, familyName: 'Familie Kurz', phone: '0171 1234567', email: 'kurz@example.de',
  childFirstName: 'Lena', childLastName: 'Kurz', childBirthDate: '2024-05-02', desiredStart: '2027-09-01',
  guidedByEmployeeId: null, guidedByName: 'Frau Berg', notes: 'Interesse an der Krippe',
}
const applicantInput = {
  name: 'Mara Lind', phone: '0160 555', email: 'mara@example.de', kind: 'hospitation', notes: 'offen', mentorEmployeeId: null,
  days: [{ date: '2026-12-02', from: 480, to: 720 }, { date: '2026-12-01', from: null, to: null }],
}
const file = (data: Buffer, filename = 'Anmeldung.pdf') => ({ data, filename })
const textContent = { sections: [{ title: 'Eindruck', hint: '', items: [{ kind: 'text', question: 'Wie war es?' }] }] }

describe('info visits and applicants', () => {
  let db: Db
  let leitung: VisitActor
  let traeger: VisitActor
  let anna: number
  let infoTemplate: number
  let applicantTemplate: number

  beforeEach(() => {
    db = createTestDb()
    leitung = actorOf(addUser(db, 'leitung', 'admin'))
    traeger = actorOf(addUser(db, 'traeger', 'provider'))
    anna = addEmployee(db, 'Anna Probe')
    infoTemplate = createTemplate(db, leitung, 1, { kind: 'info', name: 'Infogespräch', selfAssessment: false }, NOW)
    updateTemplate(db, leitung, 1, infoTemplate, { content: textContent }, NOW)
    applicantTemplate = createTemplate(db, leitung, 1, { kind: 'applicant', name: 'Hospitationsbogen', selfAssessment: false }, NOW)
    updateTemplate(db, leitung, 1, applicantTemplate, { content: textContent }, NOW)
  })

  const itemIdOf = (formId: number) => getVisitForm(db, leitung, formId).content.sections[0]!.items[0]!.id

  describe('info visits', () => {
    it('creates, lists, reads, changes and declines an info visit', () => {
      const id = createInfoVisit(db, leitung, { ...infoInput, guidedByEmployeeId: anna }, NOW)
      expect(listInfoVisits(db, leitung)).toEqual([expect.objectContaining({
        id, familyName: 'Familie Kurz', status: 'open', guidedBy: 'Anna Probe', documentCount: 0, formCount: 0, childId: null,
      })])
      const visit = getInfoVisit(db, leitung, id, '2026-11-25')
      expect(visit).toMatchObject({ guidedByName: '', notes: 'Interesse an der Krippe', createdBy: 'leitung', templates: [{ id: infoTemplate, name: 'Infogespräch' }] })
      expect(visit.staff.map(person => person.name)).toEqual(['Anna Probe'])
      updateInfoVisit(db, leitung, id, { ...infoInput, status: 'declined' }, LATER)
      expect(getInfoVisit(db, leitung, id)).toMatchObject({ status: 'declined', guidedBy: 'Frau Berg', updatedAt: LATER.toISOString() })
    })

    it('refuses invalid input with German codes and a guide from elsewhere', () => {
      expect(errorCode(() => createInfoVisit(db, leitung, { ...infoInput, email: 'kein-at' }, NOW))).toBe('email_invalid')
      expect(errorCode(() => createInfoVisit(db, leitung, { ...infoInput, familyName: '' }, NOW))).toBe('visit_name_required')
      expect(errorCode(() => createInfoVisit(db, leitung, { ...infoInput, notes: 'x'.repeat(2001) }, NOW))).toBe('notes_too_long')
      const other = addFacility(db, 'Hort')
      const foreign = addEmployee(db, 'Fremd', { facilityId: other })
      expect(errorCode(() => createInfoVisit(db, leitung, { ...infoInput, guidedByEmployeeId: foreign }, NOW))).toBe('employee_not_found')
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      expect(errorCode(() => updateInfoVisit(db, leitung, id, { ...infoInput, status: 'waitlisted' }, NOW))).toBe('invalid_input')
    })

    it('keeps every facility to its own records and needs visits.manage', () => {
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      const hort = addFacility(db, 'Hort')
      const hortLeitung = actorOf(addUser(db, 'hortleitung', 'admin', null, hort))
      expect(listInfoVisits(db, hortLeitung)).toEqual([])
      expect(errorCode(() => getInfoVisit(db, hortLeitung, id))).toBe('visit_not_found')
      expect(errorCode(() => deleteInfoVisit(db, hortLeitung, id))).toBe('visit_not_found')
      const staff = actorOf(addUser(db, 'mitarbeiter', 'observer', anna))
      expect(errorCode(() => listInfoVisits(db, staff))).toBe('forbidden')
      expect(errorCode(() => createInfoVisit(db, staff, infoInput, NOW))).toBe('forbidden')
    })
  })

  describe('documents', () => {
    it('stores PDF, JPEG and PNG judged by their bytes, with the fillable flag, and refuses anything else', () => {
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      const docId = uploadVisitDocument(db, leitung, 'info', id, '', file(fillablePdf()), LATER)
      uploadVisitDocument(db, leitung, 'info', id, 'Scan', file(plainPdf(), 'scan.pdf'), LATER)
      const visit = getInfoVisit(db, leitung, id)
      expect(visit.documents.map(doc => [doc.title, doc.fillable, doc.uploadedBy])).toEqual(
        expect.arrayContaining([['Anmeldung', true, 'leitung'], ['Scan', false, 'leitung']]))
      expect(visit.updatedAt).toBe(LATER.toISOString())
      expect(errorCode(() => uploadVisitDocument(db, leitung, 'info', id, 'X', file(Buffer.from('MZ fake exe')), NOW))).toBe('document_type_invalid')
      expect(errorCode(() => uploadVisitDocument(db, leitung, 'info', id, 'X', file(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(30 * 1024 * 1024)])), NOW)))
        .toBe('document_too_large')
      const read = readVisitDocumentFile(db, leitung, docId)
      expect(read).toMatchObject({ mimeType: 'application/pdf', fileName: 'Familie-Kurz-Anmeldung.pdf' })
      replaceVisitDocumentFile(db, leitung, docId, file(plainPdf()), LATER)
      expect(getInfoVisit(db, leitung, id).documents.find(doc => doc.id === docId)!.fillable).toBe(false)
      deleteVisitDocument(db, leitung, docId, LATER)
      expect(getInfoVisit(db, leitung, id).documents).toHaveLength(1)
    })

    it('hides another facility\'s documents and keeps info visit documents from the applicants\' readers', () => {
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      const docId = uploadVisitDocument(db, leitung, 'info', id, '', file(plainPdf()), NOW)
      const hort = addFacility(db, 'Hort')
      expect(errorCode(() => readVisitDocumentFile(db, actorOf(addUser(db, 'hl', 'admin', null, hort)), docId))).toBe('document_not_found')
      const lead = addUser(db, 'gruppenleitung', 'group_lead', addEmployee(db, 'Gabi'))
      saveRoleBundle(db, 'group_lead', 'visitsApplicantsView', true)
      const reader = actorOf(refreshPermissions(db, lead))
      expect(errorCode(() => readVisitDocumentFile(db, reader, docId))).toBe('forbidden')
    })
  })

  describe('forms', () => {
    it('makes forms only from templates of the matching kind and saves answers with the conflict check', () => {
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      expect(errorCode(() => createVisitForm(db, leitung, 'info', id, applicantTemplate, NOW))).toBe('form_template_not_found')
      const formId = createVisitForm(db, leitung, 'info', id, infoTemplate, NOW)
      const form = getVisitForm(db, leitung, formId)
      expect(form).toMatchObject({ kind: 'info', title: 'Infogespräch', editable: true, answers: {} })
      const item = itemIdOf(formId)
      const saved = saveVisitForm(db, leitung, formId, { answers: { [item]: 'Sehr interessiert' }, expectedUpdatedAt: form.updatedAt }, LATER)
      expect(saved.updatedBy).toBe('leitung')
      expect(errorCode(() => saveVisitForm(db, leitung, formId, { answers: {}, expectedUpdatedAt: form.updatedAt }, LATER))).toBe('form_changed')
      expect(getInfoVisit(db, leitung, id).forms).toEqual([expect.objectContaining({ id: formId, title: 'Infogespräch' })])
    })
  })

  describe('„Als Vormerkung übernehmen“', () => {
    it('creates the waitlist child with the contact, moves documents and forms and marks the visit', () => {
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      uploadVisitDocument(db, leitung, 'info', id, 'Anmeldung', file(fillablePdf()), NOW)
      const formId = createVisitForm(db, leitung, 'info', id, infoTemplate, NOW)
      const attest = documentTypeId(db, 1, 'Ärztliches Attest')
      expect(errorCode(() => takeOverInfoVisit(db, leitung, id, { birthDate: '2024-05-02', documentTypeId: null }, LATER))).toBe('document_type_required')
      const childId = takeOverInfoVisit(db, leitung, id, { birthDate: '2024-05-02', documentTypeId: attest }, LATER)
      expect(db.select().from(children).where(eq(children.id, childId)).get()).toMatchObject({
        firstName: 'Lena', lastName: 'Kurz', birthDate: '2024-05-02', admissionStatus: 'waitlist', waitlistedOn: '2026-11-25',
        infoMeetingDate: '2026-11-20', plannedEntryDate: '2027-09-01', note: 'Interesse an der Krippe', entryDate: null,
      })
      expect(listContacts(db, childId)).toEqual([expect.objectContaining({ name: 'Familie Kurz', phoneMobile: '0171 1234567', note: 'E-Mail: kurz@example.de' })])
      expect(db.select({ title: childDocuments.title, typeId: childDocuments.documentTypeId, fillable: childDocuments.fillable })
        .from(childDocuments).where(eq(childDocuments.childId, childId)).all()).toEqual([{ title: 'Anmeldung', typeId: attest, fillable: true }])
      expect(db.select().from(visitDocuments).all()).toEqual([])
      expect(db.select({ childId: forms.childId, infoVisitId: forms.infoVisitId }).from(forms).where(eq(forms.id, formId)).get())
        .toEqual({ childId, infoVisitId: null })
      expect(getInfoVisit(db, leitung, id)).toMatchObject({ status: 'waitlisted', childId, documents: [], forms: [] })
      // The info form is in the record's forms, read only.
      const viewer = asChildViewer(leitung)
      const list = listChildForms(db, viewer, childId, LATER)
      expect(list.forms).toEqual([expect.objectContaining({ id: formId, right: 'read', infoVisit: true })])
      const form = getChildForm(db, viewer, formId, LATER)
      expect(errorCode(() => saveChildForm(db, viewer, formId, {
        date: '2026-11-20', start: null, participants: '', answers: {}, expectedUpdatedAt: form.updatedAt,
      }, LATER))).toBe('forbidden')
      // A taken-over visit is only read; it goes with the child.
      expect(errorCode(() => updateInfoVisit(db, leitung, id, infoInput, LATER))).toBe('visit_transferred')
      expect(errorCode(() => uploadVisitDocument(db, leitung, 'info', id, '', file(plainPdf()), LATER))).toBe('visit_transferred')
      db.delete(children).where(eq(children.id, childId)).run()
      expect(db.select().from(infoVisits).all()).toEqual([])
    })

    it('needs the child\'s names and the right to create children', () => {
      const unnamed = createInfoVisit(db, leitung, { ...infoInput, childFirstName: '' }, NOW)
      expect(errorCode(() => takeOverInfoVisit(db, leitung, unnamed, { birthDate: '2024-05-02', documentTypeId: null }, NOW))).toBe('visit_child_name_required')
      const id = createInfoVisit(db, leitung, infoInput, NOW)
      saveRoleBundle(db, 'admin', 'childrenEdit', false)
      const withoutChildren = actorOf(refreshPermissions(db, leitung))
      expect(errorCode(() => takeOverInfoVisit(db, withoutChildren, id, { birthDate: '2024-05-02', documentTypeId: null }, NOW))).toBe('forbidden')
      expect(db.select().from(children).all()).toEqual([])
    })
  })

  describe('applicants', () => {
    it('creates with days, lists, changes the days, declines and opens again', () => {
      const id = createApplicant(db, leitung, { ...applicantInput, mentorEmployeeId: anna }, NOW)
      expect(listApplicants(db, leitung)).toEqual([expect.objectContaining({
        id, name: 'Mara Lind', kind: 'hospitation', status: 'open', firstDay: '2026-12-01', lastDay: '2026-12-02', dayCount: 2, mentorName: 'Anna Probe',
      })])
      updateApplicant(db, leitung, id, { ...applicantInput, days: [{ date: '2026-12-05', from: 540, to: 600 }], status: 'declined' }, LATER)
      expect(getApplicant(db, leitung, id)).toMatchObject({
        status: 'declined', declinedAt: '2026-11-25', days: [{ date: '2026-12-05', from: 540, to: 600 }], canManage: true,
      })
      updateApplicant(db, leitung, id, { ...applicantInput, status: 'open' }, LATER)
      expect(getApplicant(db, leitung, id)).toMatchObject({ status: 'open', declinedAt: null, dayCount: 2 })
      expect(errorCode(() => updateApplicant(db, leitung, id, { ...applicantInput, days: [{ date: '2026-12-01' }, { date: '2026-12-01' }] }, LATER)))
        .toBe('visit_day_duplicate')
      deleteApplicant(db, leitung, id)
      expect(db.select().from(applicantVisitDays).all()).toEqual([])
    })

    it('lets a Gruppenleitung with the view read but not change, and nobody else', () => {
      const id = createApplicant(db, leitung, applicantInput, NOW)
      const lead = addUser(db, 'gruppenleitung', 'group_lead', addEmployee(db, 'Gabi'))
      expect(errorCode(() => listApplicants(db, actorOf(lead)))).toBe('forbidden')
      saveRoleBundle(db, 'group_lead', 'visitsApplicantsView', true)
      const reader = actorOf(refreshPermissions(db, lead))
      expect(getApplicant(db, reader, id)).toMatchObject({ canManage: false, templates: [], staff: [] })
      expect(errorCode(() => updateApplicant(db, reader, id, applicantInput, NOW))).toBe('forbidden')
      expect(errorCode(() => listInfoVisits(db, reader))).toBe('forbidden')
    })

    it('„Einstellen“: creates the employee with contact data, moves documents into the folder and forms into the personnel file', () => {
      const id = createApplicant(db, leitung, applicantInput, NOW)
      uploadVisitDocument(db, leitung, 'applicant', id, 'Lebenslauf', file(plainPdf()), NOW)
      const formId = createVisitForm(db, leitung, 'applicant', id, applicantTemplate, NOW)
      const hire = { shortName: 'ML', validFrom: '2027-01-01', weeklyMinutes: 30 * 60, groupId: null, folder: 'application' as const }
      // The Leitung may not use the folder „Bewerbung“ by default; „Qualifikationen“ yes.
      expect(errorCode(() => hireApplicant(db, leitung, id, hire, LATER))).toBe('forbidden')
      expect(errorCode(() => hireApplicant(db, leitung, id, { ...hire, folder: null }, LATER))).toBe('folder_required')
      const employeeId = hireApplicant(db, leitung, id, { ...hire, folder: 'qualifications' }, LATER)
      expect(db.select().from(employees).where(eq(employees.id, employeeId)).get())
        .toMatchObject({ name: 'Mara Lind', shortName: 'ML', phone: '0160 555', email: 'mara@example.de', facilityId: 1 })
      expect(db.select({ folder: employeeDocuments.folder, title: employeeDocuments.title }).from(employeeDocuments)
        .where(eq(employeeDocuments.employeeId, employeeId)).all()).toEqual([{ folder: 'qualifications', title: 'Lebenslauf' }])
      expect(getApplicant(db, leitung, id)).toMatchObject({ status: 'hired', employeeId, documents: [], forms: [] })
      expect(listApplicationForms(db, leitung, employeeId).map(form => form.id)).toEqual([formId])
      expect(errorCode(() => updateApplicant(db, leitung, id, applicantInput, LATER))).toBe('visit_transferred')
      // The application goes with the employee's „Beurteilungen und Zeugnisse“, not with the accident reports.
      expect(categoryHasData(db, employeeId).assessment).toBe(true)
      deletePaidOvertimeData(db, employeeId)
      expect(db.select().from(forms).where(eq(forms.id, formId)).get()).toBeDefined()
      deleteAssessmentData(db, employeeId)
      expect(db.select().from(forms).where(eq(forms.id, formId)).get()).toBeUndefined()
      expect(db.select().from(applicantVisits).all()).toEqual([])
    })

    it('needs the right to create employees for „Einstellen“', () => {
      const id = createApplicant(db, leitung, applicantInput, NOW)
      saveRoleBundle(db, 'admin', 'employeesEdit', false)
      const without = actorOf(refreshPermissions(db, leitung))
      expect(errorCode(() => hireApplicant(db, without, id, { shortName: 'ML', validFrom: '2027-01-01', weeklyMinutes: 600, groupId: null, folder: null }, NOW)))
        .toBe('forbidden')
    })

    it('clears a deleted employee as guide and mentor, keeping the records', () => {
      const info = createInfoVisit(db, leitung, { ...infoInput, guidedByEmployeeId: anna }, NOW)
      const applicant = createApplicant(db, leitung, { ...applicantInput, mentorEmployeeId: anna }, NOW)
      deleteImmediateData(db, anna)
      expect(getInfoVisit(db, leitung, info).guidedByEmployeeId).toBeNull()
      expect(getApplicant(db, leitung, applicant).mentorEmployeeId).toBeNull()
    })
  })

  describe('Löschfristen', () => {
    it('lists info visits not taken over by visit day and declined applicants by refusal, open ones after 12 quiet months', () => {
      setRetentionSettings(db, 1, { ...RETENTION_DEFAULTS, infoVisitMonths: 3, applicantMonths: 2 })
      const old = createInfoVisit(db, leitung, { ...infoInput, visitDate: '2026-05-10' }, NOW)
      const recent = createInfoVisit(db, leitung, { ...infoInput, familyName: 'Berg', visitDate: '2026-11-01' }, NOW)
      const taken = createInfoVisit(db, leitung, { ...infoInput, familyName: 'Nord' }, NOW)
      takeOverInfoVisit(db, leitung, taken, { birthDate: '2024-05-02', documentTypeId: null }, NOW)
      const declined = createApplicant(db, leitung, { ...applicantInput, days: [] }, NOW)
      updateApplicant(db, leitung, declined, { ...applicantInput, days: [], status: 'declined' }, new Date('2026-08-01T10:00:00Z'))
      const quiet = createApplicant(db, leitung, { ...applicantInput, name: 'Ole', days: [{ date: '2025-10-01', from: null, to: null }] }, new Date('2025-09-01T10:00:00Z'))
      createApplicant(db, leitung, { ...applicantInput, name: 'Neu' }, NOW)
      const items = retentionOverview(db, '2026-11-25').filter(item => item.kind === 'infoVisit' || item.kind === 'applicant')
      expect(items.map(item => [item.key, item.deletableFrom, item.due, item.applicantState ?? null])).toEqual([
        [`infoVisit:${old}`, '2026-08-10', true, null],
        [`applicant:${declined}`, '2026-10-01', true, 'declined'],
        [`applicant:${quiet}`, '2026-10-01', true, 'open'],
        [`infoVisit:${recent}`, '2027-02-01', false, null],
      ])
      uploadVisitDocument(db, leitung, 'info', old, '', file(plainPdf()), NOW)
      createVisitForm(db, leitung, 'info', old, infoTemplate, NOW)
      expect(errorCode(() => deleteRetentionItem(db, leitung, `infoVisit:${old}`, '2026-11-25'))).toBe('forbidden')
      expect(errorCode(() => deleteRetentionItem(db, traeger, `infoVisit:${recent}`, '2026-11-25'))).toBe('retention_not_due')
      expect(errorCode(() => deleteRetentionItem(db, traeger, `infoVisit:${taken}`, '2026-11-25'))).toBe('retention_item_not_found')
      expect(deleteRetentionItem(db, traeger, `infoVisit:${old}`, '2026-11-25')).toBe(1)
      expect(db.select().from(visitDocuments).all()).toEqual([])
      expect(db.select().from(forms).where(eq(forms.kind, 'info')).all()).toHaveLength(0)
      expect(deleteRetentionItem(db, traeger, `applicant:${declined}`, '2026-11-25')).toBe(1)
      expect(getApplicant(db, leitung, quiet).id).toBe(quiet)
    })
  })
})
