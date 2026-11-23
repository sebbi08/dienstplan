import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { templateCategories } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import { replaceDocumentFile, uploadDocument } from '../../server/services/childDocuments'
import { replaceEmployeeDocumentFile, uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { uploadIfsgDocument } from '../../server/services/ifsgLocal'
import { replaceTemplateFile, uploadTemplate, type TemplateActor } from '../../server/services/printTemplates'
import { parseSchoolDistrictFile } from '../../server/services/schoolDistricts'
import { createCategory } from '../../server/services/templateCategories'
import { MAX_UPLOAD_BYTES } from '../../shared/domain/uploads'
import { addChild, addEmployee, addUser, asChildViewer, createTestDb, documentTypeId, errorCode } from '../helpers/fixtures'

/**
 * The 30 MB limit at every upload path not covered next to its feature (child and personnel documents, Vorlagen, cash
 * receipts, accident attachments, „Wissen“ and the IfSG attest have theirs in their own test files): exactly 30 MB is
 * stored, one byte more is 413 document_too_large. The street list keeps its own 10 MB.
 */

const TODAY = '2026-11-23'
const NOW = new Date('2026-11-23T09:00:00.000Z')
const PDF_HEAD = Buffer.from('%PDF-1.7\n', 'latin1')
/** A PDF of exactly `size` bytes (header plus padding). */
const pdfOf = (size: number) => Buffer.concat([PDF_HEAD, Buffer.alloc(size - PDF_HEAD.length, 0x20)])
const exact = pdfOf(MAX_DOCUMENT_BYTES)
const over = pdfOf(MAX_DOCUMENT_BYTES + 1)

describe('upload limit of 30 MB', () => {
  let db: Db

  beforeEach(() => {
    db = createTestDb()
  })

  it('is one shared value', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(30 * 1024 * 1024)
    expect(MAX_UPLOAD_BYTES).toBe(MAX_DOCUMENT_BYTES)
  })

  it('child document: „Weiter ausfüllen“ (replace the file)', () => {
    const admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const child = addChild(db, 1)
    const meta = { typeId: documentTypeId(db, 1, 'Sonstiges'), title: 'Bogen', documentDate: TODAY, confidential: false }
    const id = uploadDocument(db, admin, 1, child, meta, { data: PDF_HEAD, filename: 'a.pdf' }, TODAY, NOW)
    expect(errorCode(() => replaceDocumentFile(db, admin, 1, id, { data: over, filename: 'a.pdf' }, TODAY, NOW))).toBe('document_too_large')
    replaceDocumentFile(db, admin, 1, id, { data: exact, filename: 'a.pdf' }, TODAY, NOW)
  })

  it('personnel file: replace the file', () => {
    const traeger = addUser(db, 'traeger', 'provider')
    const anna = addEmployee(db, 'Anna')
    const id = uploadEmployeeDocument(db, traeger, 1, anna, { folder: 'correspondence', title: 'Brief', documentDate: TODAY, note: '' },
      { data: PDF_HEAD, filename: 'a.pdf' }, NOW)
    expect(errorCode(() => replaceEmployeeDocumentFile(db, traeger, 1, id, { data: over, filename: 'a.pdf' }, NOW))).toBe('document_too_large')
    replaceEmployeeDocumentFile(db, traeger, 1, id, { data: exact, filename: 'a.pdf' }, NOW)
  })

  it('Vorlagen: replace the file', () => {
    db.delete(templateCategories).run()
    const user = addUser(db, 'leitung', 'admin')
    const leitung: TemplateActor = { id: user.id, role: user.role, permissions: user.permissions, facilityId: 1 }
    const categoryId = createCategory(db, leitung, { name: 'Eltern', visibility: 'all' })
    const id = uploadTemplate(db, leitung, { title: 'Bogen', categoryId, scope: 'facility' }, { data: PDF_HEAD, filename: 'a.pdf' }, NOW)
    expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: over, filename: 'a.pdf' }, NOW))).toBe('document_too_large')
    replaceTemplateFile(db, leitung, id, { data: exact, filename: 'a.pdf' }, NOW)
  })

  it('health office documents (IfSG)', () => {
    const leitung = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => uploadIfsgDocument(db, { id: leitung.id, facilityId: 1 }, 'Merkblatt', { data: over }, NOW))).toBe('document_too_large')
    expect(uploadIfsgDocument(db, { id: leitung.id, facilityId: 1 }, 'Merkblatt', { data: exact }, NOW)).toBeGreaterThan(0)
  })

  it('the street list (Schulbezirke) keeps 10 MB, with its own message', async () => {
    const ten = 10 * 1024 * 1024
    await expect(parseSchoolDistrictFile({ data: Buffer.alloc(ten + 1, 0x41), filename: 'liste.csv' })).rejects.toMatchObject({ code: 'school_district_file_too_large' })
    // Exactly 10 MB passes the size check (and then finds no rows in this filler).
    await expect(parseSchoolDistrictFile({ data: Buffer.alloc(ten, 0x41), filename: 'liste.csv' })).rejects.toMatchObject({ code: 'school_district_no_rows' })
  })
})
