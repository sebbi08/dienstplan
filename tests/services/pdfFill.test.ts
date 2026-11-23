import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDocuments, childGroupChanges, employeeDocuments, printTemplates, templateCategories } from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import {
  documentTargets, listDocuments, readDocumentFile, replaceDocumentFile, uploadDocument,
} from '../../server/services/childDocuments'
import {
  listEmployeeDocuments, readEmployeeDocumentFile, replaceEmployeeDocumentFile, uploadEmployeeDocument,
} from '../../server/services/employeeDocuments'
import { listTemplates, readTemplateFile, replaceTemplateFile, uploadTemplate, type TemplateActor } from '../../server/services/printTemplates'
import { backfillFillable } from '../../server/services/fillableBackfill'
import { createCategory } from '../../server/services/templateCategories'
import type { SessionUser } from '../../shared/types/api'
import { compressedFillablePdf, fillablePdf, plainPdf } from '../helpers/fillablePdf'
import {
  addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, documentTypeId, errorCode, permissionsOf,
} from '../helpers/fixtures'

/**
 * „Ausfüllen“ of PDF forms: which templates and documents count as fillable, and the writes the fill view uses — a new
 * document in the child's record or the personnel file (the upload routes, same rights) and „Weiter ausfüllen“, which
 * replaces the file of a document.
 */

const TODAY = '2026-11-20'
const NOW = new Date('2026-11-20T09:00:00.000Z')
const LATER = new Date('2026-11-21T10:30:00.000Z')
/** A filled copy: the form with one more line, as pdf.js appends an incremental update (still has its fields). */
const filled = (marker = 'filled') => Buffer.concat([fillablePdf(), Buffer.from(`% ${marker}\n`)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])

describe('PDF forms to fill in the app', () => {
  let db: Db
  let other: number

  beforeEach(() => {
    db = createTestDb()
    other = addFacility(db, 'Krippe')
  })

  describe('templates', () => {
    let leitung: TemplateActor
    let categoryId: number
    const actor = (user: SessionUser): TemplateActor => ({ id: user.id, role: user.role, permissions: user.permissions, facilityId: user.facilityId! })

    beforeEach(() => {
      db.delete(templateCategories).run()
      leitung = actor(addUser(db, 'leitung', 'admin'))
      categoryId = createCategory(db, leitung, { name: 'Eltern', visibility: 'all' })
    })
    const upload = (data: Buffer, title: string) =>
      uploadTemplate(db, leitung, { title, categoryId, scope: 'facility' }, { data, filename: `${title}.pdf` }, NOW)
    const flags = () => Object.fromEntries(listTemplates(db, leitung).map(template => [template.title, template.fillable]))

    it('marks templates with form fields as fillable (also fields in a compressed object stream), others not', () => {
      upload(fillablePdf(), 'Einverständnis')
      upload(compressedFillablePdf(), 'Gepackt')
      upload(plainPdf(), 'Aushang')
      expect(flags()).toEqual({ Aushang: false, Einverständnis: true, Gepackt: true })
    })

    it('stores the judgment with the file and judges a replaced file again; the list reads only the column', () => {
      const id = upload(plainPdf(), 'Bogen')
      expect(db.select().from(printTemplates).get()!.fillable).toBe(false)
      replaceTemplateFile(db, leitung, id, { data: fillablePdf(), filename: 'neu.pdf' }, NOW)
      expect(db.select().from(printTemplates).get()!.fillable).toBe(true)
      expect(flags()).toEqual({ Bogen: true })
      // The list never looks at the bytes: another file written behind its back changes nothing there.
      db.update(printTemplates).set({ data: plainPdf(), size: plainPdf().length, updatedAt: LATER.toISOString() })
        .where(eq(printTemplates.id, id)).run()
      expect(flags()).toEqual({ Bogen: true })
    })

    it('a template of before (not judged yet) offers no „Ausfüllen“ until the background run judged it', async () => {
      const id = upload(fillablePdf(), 'Bogen')
      upload(plainPdf(), 'Aushang')
      db.update(printTemplates).set({ fillable: null }).run()
      expect(flags()).toEqual({ Aushang: false, Bogen: false })
      expect(await backfillFillable(db, 1)).toBe(2)
      expect(flags()).toEqual({ Aushang: false, Bogen: true })
      expect(db.select().from(printTemplates).all().find(row => row.id === id)!.fillable).toBe(true)
      // Nothing left to judge.
      expect(await backfillFillable(db)).toBe(0)
    })

    it('filling never changes the template itself', () => {
      const id = upload(fillablePdf(), 'Bogen')
      const before = readTemplateFile(db, leitung, id).data
      const childId = addChild(db, 1)
      uploadDocument(db, asChildViewer(addUser(db, 'l2', 'admin')), 1, childId,
        { typeId: documentTypeId(db, 1, 'Sonstiges'), title: 'Bogen 20.11.2026', documentDate: TODAY, confidential: false },
        { data: filled(), filename: 'Bogen.pdf' }, TODAY, NOW)
      expect(readTemplateFile(db, leitung, id).data.equals(before)).toBe(true)
    })
  })

  describe('child record', () => {
    let admin: ChildActor
    let plain: ChildActor
    let childId: number
    let miscType: number
    let attestType: number

    beforeEach(() => {
      admin = asChildViewer(addUser(db, 'leitung', 'admin'))
      plain = asChildViewer(addUser(db, 'plain', 'observer', addEmployee(db, 'Plain')))
      childId = addChild(db, 1, { lastName: 'Kurz', firstName: 'Lena' })
      miscType = documentTypeId(db, 1, 'Sonstiges')
      attestType = documentTypeId(db, 1, 'Ärztliches Attest')
    })
    const save = (actor: ChildActor, overrides: Partial<{ typeId: number; title: string; confidential: boolean }> = {}, facilityId = 1, id = childId, data = filled()) =>
      uploadDocument(db, actor, facilityId, id,
        { typeId: miscType, title: 'Einverständnis 20.11.2026', documentDate: TODAY, confidential: false, ...overrides },
        { data, filename: 'Einverständnis.pdf' }, TODAY, NOW)

    it('saves the filled form with the chosen type, title and confidentiality and offers „Weiter ausfüllen“', () => {
      const id = save(admin, { typeId: attestType, confidential: true })
      const [document] = listDocuments(db, admin, 1, childId, TODAY)
      expect(document).toMatchObject({ id, typeId: attestType, typeName: 'Ärztliches Attest', title: 'Einverständnis 20.11.2026', confidential: true, fillable: true })
      expect(readDocumentFile(db, admin, 1, id, TODAY).data.equals(filled())).toBe(true)
      // A confidential document is no form to fill for whoever may not open it.
      expect(listDocuments(db, plain, 1, childId, TODAY)[0]).toMatchObject({ canOpen: false, fillable: false })
    })

    it('a scan or photo is no form to fill', () => {
      save(admin, { title: 'Scan' }, 1, childId, plainPdf())
      save(admin, { title: 'Foto' }, 1, childId, png())
      expect(listDocuments(db, admin, 1, childId, TODAY).map(document => document.fillable)).toEqual([false, false])
    })

    it('is refused for a child of another facility and in a group the actor may only read', () => {
      const foreign = addChild(db, other)
      expect(errorCode(() => save(admin, {}, 1, foreign))).toBe('child_not_found')
      const own = addGroup(db, 1, 'Bären')
      const readOnly = addGroup(db, 1, 'Füchse')
      const inReadOnly = addChild(db, 1, { groupId: readOnly })
      const scoped: ChildActor = { ...admin, groups: { own, readable: [readOnly] } }
      expect(errorCode(() => save(scoped, {}, 1, inReadOnly))).toBe('group_read_only')
      expect(db.select().from(childDocuments).all()).toHaveLength(0)
    })

    it('lists as targets only the children the actor may add documents to', () => {
      const own = addGroup(db, 1, 'Bären')
      const readOnly = addGroup(db, 1, 'Füchse')
      const hidden = addGroup(db, 1, 'Igel')
      addChild(db, 1, { lastName: 'Bär', firstName: 'Ben', groupId: own })
      addChild(db, 1, { lastName: 'Fuchs', firstName: 'Fritz', groupId: readOnly })
      addChild(db, 1, { lastName: 'Igel', firstName: 'Ida', groupId: hidden })
      addChild(db, 1, { lastName: 'Alt', firstName: 'Anna', leftOn: '2026-07-31' })
      addChild(db, 1, { lastName: 'Neu', firstName: 'Nora', entryDate: '2027-01-01' })
      addChild(db, other, { lastName: 'Anders' })
      expect(documentTargets(db, admin, 1, TODAY).map(child => [child.lastName, child.groupName, child.planned])).toEqual([
        ['Bär', 'Bären', false], ['Fuchs', 'Füchse', false], ['Igel', 'Igel', false], ['Kurz', null, false], ['Neu', null, true],
      ])
      const scoped: ChildActor = { ...admin, groups: { own, readable: [readOnly] } }
      // No group (Kurz, Neu) counts as writable, as for the record itself.
      expect(documentTargets(db, scoped, 1, TODAY).map(child => child.lastName)).toEqual(['Bär', 'Kurz', 'Neu'])
      // The tablet switches hide planned children from the person who unlocked it.
      const tablet: ChildActor = { ...admin, visibility: { waitlist: false, futureContracts: false } }
      expect(documentTargets(db, tablet, 1, TODAY).map(child => child.lastName)).not.toContain('Neu')
    })

    it('judges a group change whose day has come as applied, like the save of the child then does', () => {
      const own = addGroup(db, 1, 'Bären')
      const readOnly = addGroup(db, 1, 'Füchse')
      const moving = addChild(db, 1, { lastName: 'Wechsel', groupId: readOnly })
      db.insert(childGroupChanges).values({ childId: moving, groupId: own, fromDate: TODAY, createdAt: NOW.toISOString() }).run()
      const scoped: ChildActor = { ...admin, groups: { own, readable: [readOnly] } }
      expect(documentTargets(db, scoped, 1, TODAY, NOW).map(child => [child.lastName, child.groupName])).toContainEqual(['Wechsel', 'Bären'])
      expect(save(scoped, {}, 1, moving)).toBeGreaterThan(0)
    })

    it('a document of before (not judged yet) is judged by the background run; photos are no forms', async () => {
      const form = save(admin)
      const photo = save(admin, { title: 'Foto' }, 1, childId, png())
      db.update(childDocuments).set({ fillable: null }).run()
      expect(listDocuments(db, admin, 1, childId, TODAY).every(document => !document.fillable)).toBe(true)
      expect(await backfillFillable(db)).toBe(2)
      const judged = Object.fromEntries(db.select().from(childDocuments).all().map(row => [row.id, row.fillable]))
      expect(judged).toEqual({ [form]: true, [photo]: false })
    })

    describe('„Weiter ausfüllen“', () => {
      it('replaces the file, keeps type, title, date and confidentiality, and records who saved it when', () => {
        const id = save(admin, { typeId: attestType, confidential: true })
        const second = asChildViewer(addUser(db, 'zweite', 'admin'))
        replaceDocumentFile(db, second, 1, id, { data: filled('again'), filename: 'x.pdf' }, TODAY, LATER)
        const row = db.select().from(childDocuments).where(eq(childDocuments.id, id)).get()!
        expect(row).toMatchObject({
          documentTypeId: attestType, title: 'Einverständnis 20.11.2026', documentDate: TODAY, confidential: true,
          uploadedBy: second.id, uploadedAt: LATER.toISOString(), size: filled('again').length,
        })
        expect(row.data.equals(filled('again'))).toBe(true)
        expect(db.select().from(childDocuments).all()).toHaveLength(1)
      })

      it('is judged again after the replacement (a flattened copy is no form any more)', () => {
        const id = save(admin)
        expect(listDocuments(db, admin, 1, childId, TODAY)[0]!.fillable).toBe(true)
        replaceDocumentFile(db, admin, 1, id, { data: plainPdf(), filename: 'x.pdf' }, TODAY, NOW)
        expect(listDocuments(db, admin, 1, childId, TODAY)[0]!.fillable).toBe(false)
      })

      it('only a PDF replaces a PDF', () => {
        const id = save(admin)
        expect(errorCode(() => replaceDocumentFile(db, admin, 1, id, { data: png(), filename: 'x.png' }, TODAY, NOW))).toBe('document_type_invalid')
        const photo = save(admin, {}, 1, childId, png())
        expect(errorCode(() => replaceDocumentFile(db, admin, 1, photo, { data: filled(), filename: 'x.pdf' }, TODAY, NOW))).toBe('document_type_invalid')
      })

      it('is refused for another facility, an archived child and a group the actor may only read', () => {
        const id = save(admin)
        const outsider = asChildViewer(addUser(db, 'zwei', 'admin', null, other))
        expect(errorCode(() => replaceDocumentFile(db, outsider, other, id, { data: filled('x'), filename: 'x.pdf' }, TODAY, NOW))).toBe('document_not_found')
        const readOnly = addGroup(db, 1, 'Füchse')
        const inReadOnly = addChild(db, 1, { groupId: readOnly })
        const there = save(admin, {}, 1, inReadOnly)
        const scoped: ChildActor = { ...admin, groups: { own: addGroup(db, 1, 'Bären'), readable: [readOnly] } }
        expect(errorCode(() => replaceDocumentFile(db, scoped, 1, there, { data: filled('x'), filename: 'x.pdf' }, TODAY, NOW))).toBe('group_read_only')
        const leaving = addChild(db, 1, { leftOn: '2026-11-25' })
        const old = save(admin, {}, 1, leaving)
        expect(errorCode(() => replaceDocumentFile(db, admin, 1, old, { data: filled('x'), filename: 'x.pdf' }, '2026-12-01', NOW))).toBe('child_archived')
        expect(db.select().from(childDocuments).all().every(row => row.data.equals(filled()))).toBe(true)
      })
    })
  })

  describe('personnel file', () => {
    let traeger: SessionUser
    let mitarbeiter: SessionUser
    let anna: number

    beforeEach(() => {
      anna = addEmployee(db, 'Anna Müller')
      traeger = addUser(db, 'traeger', 'provider')
      mitarbeiter = addUser(db, 'ma', 'observer', addEmployee(db, 'Mia'))
    })
    const save = (actor: SessionUser, folder: 'correspondence' | 'salary' = 'correspondence', facilityId = 1, id = anna, data = filled()) =>
      uploadEmployeeDocument(db, actor, facilityId, id, { folder, title: 'Belehrung 20.11.2026', documentDate: TODAY, note: '' },
        { data, filename: 'Belehrung.pdf' }, NOW)

    it('saves the filled form into a folder the actor may use, with title and „Weiter ausfüllen“', () => {
      const id = save(traeger)
      expect(listEmployeeDocuments(db, traeger, 1, anna).correspondence).toEqual([expect.objectContaining({
        id, folder: 'correspondence', title: 'Belehrung 20.11.2026', fillable: true,
      })])
      save(traeger, 'salary', 1, anna, plainPdf())
      expect(listEmployeeDocuments(db, traeger, 1, anna).salary![0]!.fillable).toBe(false)
    })

    it('is refused without the folder key and for an employee of another facility', () => {
      expect(permissionsOf('observer').has('employees.docs.correspondence')).toBe(false)
      expect(errorCode(() => save(mitarbeiter))).toBe('forbidden')
      const foreign = addEmployee(db, 'Fremd', { facilityId: other })
      expect(errorCode(() => save(traeger, 'correspondence', 1, foreign))).toBe('employee_not_found')
      expect(db.select().from(employeeDocuments).all()).toHaveLength(0)
    })

    it('„Weiter ausfüllen“ replaces the file and keeps folder, title, date and note; only with the folder key', () => {
      const id = save(traeger)
      const second = addUser(db, 'traeger2', 'provider')
      replaceEmployeeDocumentFile(db, second, 1, id, { data: filled('again'), filename: 'x.pdf' }, LATER)
      const row = db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id)).get()!
      expect(row).toMatchObject({ folder: 'correspondence', title: 'Belehrung 20.11.2026', documentDate: TODAY, uploadedBy: second.id, uploadedAt: LATER.toISOString() })
      expect(readEmployeeDocumentFile(db, second, 1, id).data.equals(filled('again'))).toBe(true)
      expect(errorCode(() => replaceEmployeeDocumentFile(db, mitarbeiter, 1, id, { data: filled('x'), filename: 'x.pdf' }, LATER))).toBe('forbidden')
      const outsider = addUser(db, 'traeger3', 'provider', null, other)
      expect(errorCode(() => replaceEmployeeDocumentFile(db, outsider, other, id, { data: filled('x'), filename: 'x.pdf' }, LATER))).toBe('document_not_found')
      expect(errorCode(() => replaceEmployeeDocumentFile(db, traeger, 1, id, { data: png(), filename: 'x.png' }, LATER))).toBe('document_type_invalid')
      expect(readEmployeeDocumentFile(db, traeger, 1, id).data.equals(filled('again'))).toBe(true)
    })
  })
})
