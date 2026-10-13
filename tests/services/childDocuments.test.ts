import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDocuments, children, users } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import { getActiveUser } from '../../server/services/auth'
import {
  deleteDocument, documentOverview, listDocuments, readDocumentFile, updateDocument, uploadDocument,
} from '../../server/services/childDocuments'
import { getChild } from '../../server/services/children'
import { deleteDocumentType, updateDocumentType } from '../../server/services/documentTypes'
import type { FacilityUser } from '../../server/utils/auth'
import type { ChildDocumentMeta } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, createTestDb, documentTypeId, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-09'
const NOW = new Date('2026-10-09T08:30:00.000Z')

const pdf = (extra = 'content') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(extra)])
const zip = () => Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])

describe('child documents', () => {
  let db: Db
  let admin: FacilityUser
  let plain: FacilityUser
  let allowed: FacilityUser
  let childId: number
  let contractType: number
  let attestType: number
  let miscType: number

  const meta = (overrides: Partial<ChildDocumentMeta> = {}): ChildDocumentMeta => ({
    typeId: contractType, title: 'Vertrag 2026', documentDate: '2026-09-01', confidential: false, ...overrides,
  })
  const upload = (overrides: Partial<ChildDocumentMeta> = {}, data: Buffer = pdf(), id = childId) =>
    uploadDocument(db, admin, 1, id, meta(overrides), { data, filename: 'scan.pdf' }, TODAY, NOW)
  const rowCount = () => db.select({ id: childDocuments.id }).from(childDocuments).all().length
  const archiveChild = () => db.update(children).set({ leftOn: '2026-09-30' }).where(eq(children.id, childId)).run()

  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin') as FacilityUser
    plain = addUser(db, 'plain', 'observer', addEmployee(db, 'Plain')) as FacilityUser
    const allowedUser = addUser(db, 'allowed', 'observer', addEmployee(db, 'Allowed'))
    db.update(users).set({ canEditChildren: true }).where(eq(users.id, allowedUser.id)).run()
    allowed = getActiveUser(db, allowedUser.id) as FacilityUser
    childId = addChild(db, 1, { lastName: 'Müller-Ö' })
    contractType = documentTypeId(db, 1, 'Betreuungsvertrag')
    attestType = documentTypeId(db, 1, 'Ärztliches Attest')
    miscType = documentTypeId(db, 1, 'Sonstiges')
  })

  describe('upload and read', () => {
    it('stores the bytes and returns them identically with the detected type', () => {
      const data = pdf('hello')
      const id = upload({}, data)
      const file = readDocumentFile(db, plain, 1, id, TODAY)
      expect(file.data.equals(data)).toBe(true)
      expect(file.mimeType).toBe('application/pdf')
      expect(file.fileName).toBe('Betreuungsvertrag-Mueller-Oe-2026-09-01.pdf')
    })

    it('stores the detected type, not what the file name claims', () => {
      const id = upload({}, png())
      expect(readDocumentFile(db, admin, 1, id, TODAY).mimeType).toBe('image/png')
      expect(readDocumentFile(db, admin, 1, id, TODAY).fileName).toMatch(/\.png$/)
    })

    it('accepts exactly 10 MB and rejects one byte more with document_too_large', () => {
      const exact = Buffer.alloc(MAX_DOCUMENT_BYTES, 0x41)
      pdf().copy(exact)
      expect(upload({}, exact)).toBeGreaterThan(0)
      const tooBig = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x41)
      pdf().copy(tooBig)
      const before = rowCount()
      expect(errorCode(() => upload({}, tooBig))).toBe('document_too_large')
      expect(rowCount()).toBe(before)
    })

    it('rejects a file whose bytes are not PDF/JPEG/PNG (a ZIP named x.pdf) and stores nothing', () => {
      expect(errorCode(() => uploadDocument(db, admin, 1, childId, meta(), { data: zip(), filename: 'x.pdf' }, TODAY, NOW)))
        .toBe('document_type_invalid')
      expect(errorCode(() => upload({}, Buffer.alloc(0)))).toBe('document_type_invalid')
      expect(rowCount()).toBe(0)
    })

    it('checks type, date and the child', () => {
      const other = addFacility(db, 'Zweite')
      const foreignType = documentTypeId(db, other, 'Sonstiges')
      expect(errorCode(() => upload({ typeId: foreignType }))).toBe('document_type_not_found')
      expect(errorCode(() => upload({ typeId: 99999 }))).toBe('document_type_not_found')
      expect(errorCode(() => upload({ documentDate: '2026-13-40' }))).toBe('invalid_date')
      expect(errorCode(() => upload({}, pdf(), 99999))).toBe('child_not_found')
      expect(errorCode(() => uploadDocument(db, admin, other, childId, meta(), { data: pdf(), filename: 'a.pdf' }, TODAY, NOW)))
        .toBe('child_not_found')
      expect(rowCount()).toBe(0)
    })

    it('rejects an upload to an archived child: child_archived for managers, child_not_found for a Mitarbeiter', () => {
      archiveChild()
      expect(errorCode(() => upload())).toBe('child_archived')
      expect(errorCode(() => uploadDocument(db, allowed, 1, childId, meta(), { data: pdf(), filename: 'a.pdf' }, TODAY, NOW)))
        .toBe('child_not_found')
      expect(rowCount()).toBe(0)
    })

    it('lists newest document date first without the file bytes, with type, uploader and canOpen', () => {
      const older = upload({ title: '  Alt  ', documentDate: '2026-01-01' })
      const newer = upload({ title: 'Neu', documentDate: '2026-08-01', typeId: miscType }, png())
      const list = listDocuments(db, admin, 1, childId, TODAY)
      expect(list.map(item => item.id)).toEqual([newer, older])
      expect(list[1]).toEqual({
        id: older, typeId: contractType, typeName: 'Betreuungsvertrag', title: 'Alt', documentDate: '2026-01-01',
        confidential: false, mimeType: 'application/pdf', size: pdf().length, uploadedBy: 'leitung',
        uploadedAt: NOW.toISOString(), canOpen: true,
      })
      expect(Object.keys(list[0]!)).not.toContain('data')
    })

    it('fills the documents of the child record', () => {
      const id = upload()
      expect(getChild(db, admin, childId, TODAY).documents.map(item => item.id)).toEqual([id])
    })
  })

  describe('visibility', () => {
    it('hides confidential documents from ordinary observers but not from permitted observers and managers', () => {
      const id = upload({ typeId: attestType, confidential: true, title: 'Gutachten Jugendamt' })
      expect(listDocuments(db, plain, 1, childId, TODAY)[0]).toMatchObject({ id, canOpen: false, title: '', typeName: 'Ärztliches Attest' })
      expect(JSON.stringify(getChild(db, plain, childId, TODAY))).not.toContain('Gutachten')
      expect(errorCode(() => readDocumentFile(db, plain, 1, id, TODAY))).toBe('document_not_found')
      expect(listDocuments(db, allowed, 1, childId, TODAY)[0]).toMatchObject({ id, canOpen: true, title: 'Gutachten Jugendamt' })
      expect(listDocuments(db, admin, 1, childId, TODAY)[0]).toMatchObject({ id, canOpen: true, title: 'Gutachten Jugendamt' })
      expect(readDocumentFile(db, allowed, 1, id, TODAY).data.length).toBeGreaterThan(0)
      expect(readDocumentFile(db, admin, 1, id, TODAY).data.length).toBeGreaterThan(0)
    })

    it('lets everybody who sees the child read a non-confidential document', () => {
      const id = upload()
      expect(readDocumentFile(db, plain, 1, id, TODAY).data.length).toBeGreaterThan(0)
    })

    it('answers document_not_found for another facility or an unknown id', () => {
      const id = upload()
      const other = addFacility(db, 'Zweite')
      const outsider = addUser(db, 'zwei', 'admin', null, other) as FacilityUser
      expect(errorCode(() => readDocumentFile(db, outsider, other, id, TODAY))).toBe('document_not_found')
      expect(errorCode(() => readDocumentFile(db, admin, 1, 99999, TODAY))).toBe('document_not_found')
      expect(errorCode(() => listDocuments(db, outsider, other, childId, TODAY))).toBe('child_not_found')
    })

    it('hides the documents of an archived child from observers, not from managers', () => {
      const id = upload()
      archiveChild()
      expect(errorCode(() => readDocumentFile(db, plain, 1, id, TODAY))).toBe('document_not_found')
      expect(errorCode(() => listDocuments(db, plain, 1, childId, TODAY))).toBe('child_not_found')
      expect(readDocumentFile(db, admin, 1, id, TODAY).data.length).toBeGreaterThan(0)
      expect(listDocuments(db, admin, 1, childId, TODAY)).toHaveLength(1)
    })
  })

  describe('update and delete', () => {
    it('changes the metadata but never the file', () => {
      const id = upload({}, pdf('keep'))
      updateDocument(db, admin, 1, id, meta({ typeId: attestType, title: ' Attest ', documentDate: '2026-09-15', confidential: true }), TODAY)
      expect(listDocuments(db, admin, 1, childId, TODAY)[0]).toMatchObject({
        id, typeId: attestType, title: 'Attest', documentDate: '2026-09-15', confidential: true,
      })
      expect(readDocumentFile(db, admin, 1, id, TODAY).data.equals(pdf('keep'))).toBe(true)
    })

    it('rejects foreign documents, foreign types, bad dates and archived children', () => {
      const id = upload()
      const other = addFacility(db, 'Zweite')
      expect(errorCode(() => updateDocument(db, admin, other, id, meta(), TODAY))).toBe('document_not_found')
      expect(errorCode(() => deleteDocument(db, admin, other, id, TODAY))).toBe('document_not_found')
      expect(errorCode(() => updateDocument(db, admin, 1, id, meta({ typeId: documentTypeId(db, other, 'Sonstiges') }), TODAY)))
        .toBe('document_type_not_found')
      expect(errorCode(() => updateDocument(db, admin, 1, id, meta({ documentDate: '2026-02-30' }), TODAY))).toBe('invalid_date')
      archiveChild()
      expect(errorCode(() => updateDocument(db, admin, 1, id, meta(), TODAY))).toBe('child_archived')
      expect(errorCode(() => deleteDocument(db, admin, 1, id, TODAY))).toBe('child_archived')
      expect(errorCode(() => updateDocument(db, allowed, 1, id, meta(), TODAY))).toBe('document_not_found')
      expect(errorCode(() => deleteDocument(db, allowed, 1, id, TODAY))).toBe('document_not_found')
      expect(rowCount()).toBe(1)
    })

    it('deletes a document, and a used document type cannot be deleted until then', () => {
      const id = upload()
      expect(errorCode(() => deleteDocumentType(db, 1, contractType))).toBe('document_type_in_use')
      deleteDocument(db, admin, 1, id, TODAY)
      expect(rowCount()).toBe(0)
      expect(errorCode(() => deleteDocument(db, admin, 1, id, TODAY))).toBe('document_not_found')
      deleteDocumentType(db, 1, contractType)
    })
  })

  describe('overview', () => {
    const rowOf = (viewer: FacilityUser = admin) => documentOverview(db, viewer, 1, TODAY).rows.find(item => item.childId === childId)!
    const setType = (name: string, input: { important: boolean; required: boolean }) => {
      const id = documentTypeId(db, 1, name)
      updateDocumentType(db, 1, id, { name, confidentialDefault: false, sortOrder: 0, ...input })
      return id
    }

    it('lists the important types in order and marks missing required documents', () => {
      const overview = documentOverview(db, admin, 1, TODAY)
      expect(overview.types.map(type => type.name)).toEqual([
        'Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung', 'Sorgerechtsbeschluss',
      ])
      const row = rowOf()
      expect(row.missingRequired).toBe(true)
      expect(row.cells[contractType]).toBeNull()
      expect(Object.keys(row.cells)).toHaveLength(5)
    })

    /** Leaves only the Betreuungsvertrag required (the defaults also require the three health and consent papers). */
    const relaxOthers = () => {
      for (const name of ['Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung']) {
        setType(name, { important: true, required: false })
      }
    }

    it('clears missingRequired once every required type has a document and shows the newest document per type', () => {
      relaxOthers()
      const custody = documentTypeId(db, 1, 'Sorgerechtsbeschluss')
      expect(rowOf().missingRequired).toBe(true)
      upload({ typeId: contractType, documentDate: '2026-01-01' })
      const newest = upload({ typeId: contractType, documentDate: '2026-06-01' })
      upload({ typeId: contractType, documentDate: '2026-03-01' })
      const row = rowOf()
      expect(row.cells[contractType]).toEqual({ documentId: newest, documentDate: '2026-06-01', canOpen: true, stale: false })
      expect(row.cells[custody]).toBeNull()
      expect(row.missingRequired).toBe(false)
      setType('Sorgerechtsbeschluss', { important: true, required: true })
      expect(rowOf().missingRequired).toBe(true)
    })

    it('ignores a missing important type that is not required', () => {
      const measles = documentTypeId(db, 1, 'Masernnachweis')
      relaxOthers()
      upload({ typeId: contractType })
      expect(rowOf().cells[measles]).toBeNull()
      expect(rowOf().missingRequired).toBe(false)
    })

    it('does not show documents of types that are not important', () => {
      upload({ typeId: miscType })
      expect(Object.keys(rowOf().cells)).not.toContain(String(miscType))
    })

    it('shows confidential cells with canOpen false to ordinary observers', () => {
      const id = upload({ confidential: true })
      expect(rowOf(plain).cells[contractType]).toEqual({ documentId: id, documentDate: '2026-09-01', canOpen: false, stale: false })
      expect(rowOf(allowed).cells[contractType]?.canOpen).toBe(true)
    })

    it('contains active children of the facility only, sorted by group order and name', () => {
      const groupId = addGroup(db, 1, 'Sonnen')
      const planned = addChild(db, 1, { entryDate: '2027-01-01' })
      const archived = addChild(db, 1, { leftOn: '2026-09-30' })
      const foreign = addChild(db, addFacility(db, 'Zweite'))
      const inGroup = addChild(db, 1, { lastName: 'Adler', groupId })
      const rows = documentOverview(db, admin, 1, TODAY).rows
      expect(rows.map(row => row.childId)).toEqual([inGroup, childId])
      for (const hidden of [planned, archived, foreign]) expect(rows.map(row => row.childId)).not.toContain(hidden)
      expect(rows[0]).toMatchObject({ name: 'Kind Adler', groupId })
    })
  })
})
