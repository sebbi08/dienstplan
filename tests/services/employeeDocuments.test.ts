import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeDocuments, users } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import {
  deleteEmployeeDocument, listEmployeeDocuments, readEmployeeDocumentFile, updateEmployeeDocument, uploadEmployeeDocument,
} from '../../server/services/employeeDocuments'
import { EMPLOYEE_DOCUMENT_FOLDERS, type EmployeeDocumentFolder } from '../../shared/domain/personnel'
import type { EmployeeDocumentMeta, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const NOW = new Date('2026-10-28T09:15:00.000Z')

const pdf = (extra = 'content') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(extra)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])
const jpeg = () => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
const zip = () => Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3])

describe('employee documents (Personalakte, Reiter Dokumente)', () => {
  let db: Db
  let traeger: SessionUser
  let leitung: SessionUser
  let mitarbeiter: SessionUser
  let anna: number

  const meta = (overrides: Partial<EmployeeDocumentMeta> = {}): EmployeeDocumentMeta => ({
    folder: 'qualifications', title: 'Erste Hilfe', documentDate: '2026-09-01', note: '', ...overrides,
  })
  const upload = (actor: SessionUser, overrides: Partial<EmployeeDocumentMeta> = {}, data: Buffer = pdf(), id = anna) =>
    uploadEmployeeDocument(db, actor, 1, id, meta(overrides), { data, filename: 'scan.pdf' }, NOW)
  const rowCount = () => db.select({ id: employeeDocuments.id }).from(employeeDocuments).all().length

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna Müller')
    traeger = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
    mitarbeiter = addUser(db, 'ma', 'observer', addEmployee(db, 'Mia'))
  })

  describe('upload and download', () => {
    it('stores the file with the detected type and returns it unchanged, PDF, JPEG and PNG alike', () => {
      for (const [data, mime, extension] of [[pdf('x'), 'application/pdf', 'pdf'], [jpeg(), 'image/jpeg', 'jpg'], [png(), 'image/png', 'png']] as const) {
        const id = upload(traeger, { folder: 'contract', title: 'Arbeitsvertrag' }, data)
        const file = readEmployeeDocumentFile(db, traeger, 1, id)
        expect(file.data.equals(data)).toBe(true)
        expect(file.mimeType).toBe(mime)
        expect(file.size).toBe(data.length)
        expect(file.fileName).toBe(`Anna-Mueller-Arbeitsvertrag-2026-09-01.${extension}`)
      }
    })

    it('refuses other file types (400) and files above the size limit (413)', () => {
      expect(errorCode(() => upload(traeger, {}, zip()))).toBe('document_type_invalid')
      const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_DOCUMENT_BYTES)])
      expect(errorCode(() => upload(traeger, {}, big))).toBe('document_too_large')
      const exact = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_DOCUMENT_BYTES - 9)])
      expect(errorCode(() => upload(traeger, {}, exact))).toBeNull()
      expect(rowCount()).toBe(1)
    })

    it('trims title and note and needs a real date', () => {
      const id = upload(traeger, { title: '  Zertifikat ', note: ' bis 2028 gültig ' })
      expect(listEmployeeDocuments(db, traeger, 1, anna).qualifications![0]).toMatchObject({
        id, folder: 'qualifications', title: 'Zertifikat', note: 'bis 2028 gültig', documentDate: '2026-09-01',
        mimeType: 'application/pdf', uploadedBy: 'traeger', uploadedAt: NOW.toISOString(),
      })
      expect(errorCode(() => upload(traeger, { documentDate: '2026-02-30' }))).toBe('invalid_date')
    })
  })

  describe('folder rights', () => {
    it('lets the Träger use every folder and lists every folder, newest first, without the bytes', () => {
      for (const folder of EMPLOYEE_DOCUMENT_FOLDERS) upload(traeger, { folder, title: folder })
      const newer = upload(traeger, { folder: 'contract', title: 'Nachtrag', documentDate: '2026-10-01' })
      const list = listEmployeeDocuments(db, traeger, 1, anna)
      expect(Object.keys(list)).toEqual([...EMPLOYEE_DOCUMENT_FOLDERS])
      expect(list.contract!.map(document => document.id)[0]).toBe(newer)
      expect(JSON.stringify(list)).not.toContain('PDF-1.7')
      expect(list.contract![0]).not.toHaveProperty('data')
    })

    it('shows the Leitung only the qualifications folder; the other folders are 403', () => {
      const ids = Object.fromEntries(EMPLOYEE_DOCUMENT_FOLDERS.map(folder => [folder, upload(traeger, { folder, title: folder })])) as
        Record<EmployeeDocumentFolder, number>
      const list = listEmployeeDocuments(db, leitung, 1, anna)
      expect(Object.keys(list)).toEqual(['qualifications'])
      expect(JSON.stringify(list)).not.toMatch(/"(contract|application|correspondence|measures|salary)"/)
      expect(readEmployeeDocumentFile(db, leitung, 1, ids.qualifications).mimeType).toBe('application/pdf')
      const own = upload(leitung, { folder: 'qualifications' })
      updateEmployeeDocument(db, leitung, 1, own, meta({ title: 'Neu' }))
      for (const folder of EMPLOYEE_DOCUMENT_FOLDERS.filter(name => name !== 'qualifications')) {
        expect(errorCode(() => upload(leitung, { folder })), folder).toBe('forbidden')
        expect(errorCode(() => readEmployeeDocumentFile(db, leitung, 1, ids[folder])), folder).toBe('forbidden')
        expect(errorCode(() => updateEmployeeDocument(db, leitung, 1, ids[folder], meta())), folder).toBe('forbidden')
        expect(errorCode(() => deleteEmployeeDocument(db, leitung, 1, ids[folder])), folder).toBe('forbidden')
        // Moving into a folder needs the right for that folder as well.
        expect(errorCode(() => updateEmployeeDocument(db, leitung, 1, own, meta({ folder }))), folder).toBe('forbidden')
      }
      expect(rowCount()).toBe(7)
      deleteEmployeeDocument(db, leitung, 1, own)
      expect(rowCount()).toBe(6)
    })

    it('gives a Mitarbeiter nothing at all', () => {
      const id = upload(traeger)
      expect(listEmployeeDocuments(db, mitarbeiter, 1, anna)).toEqual({})
      expect(errorCode(() => upload(mitarbeiter))).toBe('forbidden')
      expect(errorCode(() => readEmployeeDocumentFile(db, mitarbeiter, 1, id))).toBe('forbidden')
      expect(errorCode(() => deleteEmployeeDocument(db, mitarbeiter, 1, id))).toBe('forbidden')
    })

    it('moves a document between folders with the rights for both, and changes title, date and note only', () => {
      const id = upload(traeger, { folder: 'correspondence', title: 'Elternzeit' })
      updateEmployeeDocument(db, traeger, 1, id, { folder: 'measures', title: ' Abmahnung ', documentDate: '2026-10-02', note: 'erledigt' })
      const list = listEmployeeDocuments(db, traeger, 1, anna)
      expect(list.correspondence).toEqual([])
      expect(list.measures![0]).toMatchObject({ id, title: 'Abmahnung', documentDate: '2026-10-02', note: 'erledigt', size: pdf().length })
      expect(errorCode(() => updateEmployeeDocument(db, traeger, 1, id, meta({ documentDate: '2026-13-01' })))).toBe('invalid_date')
    })
  })

  describe('facility scope', () => {
    it('keeps the documents of another facility\'s employee unreachable (404)', () => {
      const hort = addFacility(db, 'Hort')
      const olga = addEmployee(db, 'Olga', { facilityId: hort })
      const hortTraeger = { ...traeger, facilityId: hort }
      const id = uploadEmployeeDocument(db, hortTraeger, hort, olga, meta(), { data: pdf(), filename: 'a.pdf' }, NOW)
      expect(errorCode(() => listEmployeeDocuments(db, traeger, 1, olga))).toBe('employee_not_found')
      expect(errorCode(() => upload(traeger, {}, pdf(), olga))).toBe('employee_not_found')
      expect(errorCode(() => readEmployeeDocumentFile(db, traeger, 1, id))).toBe('document_not_found')
      expect(errorCode(() => updateEmployeeDocument(db, traeger, 1, id, meta()))).toBe('document_not_found')
      expect(errorCode(() => deleteEmployeeDocument(db, traeger, 1, id))).toBe('document_not_found')
      expect(errorCode(() => readEmployeeDocumentFile(db, traeger, 1, 999))).toBe('document_not_found')
      expect(readEmployeeDocumentFile(db, hortTraeger, hort, id).mimeType).toBe('application/pdf')
    })
  })

  describe('delete', () => {
    it('deletes the document; the uploader going keeps it (uploadedBy null)', () => {
      const id = upload(leitung)
      const kept = upload(leitung, { title: 'bleibt' })
      deleteEmployeeDocument(db, traeger, 1, id)
      expect(errorCode(() => readEmployeeDocumentFile(db, traeger, 1, id))).toBe('document_not_found')
      db.delete(users).where(eq(users.id, leitung.id)).run()
      expect(listEmployeeDocuments(db, traeger, 1, anna).qualifications!.map(document => [document.id, document.uploadedBy]))
        .toEqual([[kept, null]])
    })
  })
})
