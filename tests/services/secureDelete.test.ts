import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkpointWal, createDb, migrateDb } from '../../server/db/client'
import { seedDefaults } from '../../server/db/seed'
import { createBackup } from '../../server/services/backup'
import { deleteDocument, uploadDocument } from '../../server/services/childDocuments'
import { deleteChild } from '../../server/services/children'
import { deleteEmployeeDocument, uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { deleteTemplate, replaceTemplateFile, uploadTemplate } from '../../server/services/printTemplates'
import { createCategory } from '../../server/services/templateCategories'
import { addChild, addEmployee, addUser, asChildViewer, documentTypeId } from '../helpers/fixtures'

const MARKER = 'KINDERAKTE-GEHEIM-MARKER-7f3a9c'
const TODAY = '2026-10-09'

/** A PDF of about 48 KB that consists of the recognisable marker. */
const markedPdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(`${MARKER}\n`.repeat(1600))])

const hasMarker = (file: string) => readFileSync(file).includes(MARKER)

/** The database files in `dir` (main file and, while it exists, the WAL) that still contain the marker. */
const databaseFilesWithMarker = (dir: string) => readdirSync(dir).map(name => join(dir, name)).filter(hasMarker)

describe('deleting child records leaves no trace in the database file or in backups', () => {
  function open() {
    const dir = mkdtempSync(join(tmpdir(), 'dienstplan-secure-delete-'))
    const dataDir = join(dir, 'data')
    const { db, sqlite } = createDb(join(dataDir, 'app.db'))
    migrateDb(db, 'server/db/migrations')
    seedDefaults(db)
    const admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const upload = (childId: number) => uploadDocument(db, admin, 1, childId, {
      typeId: documentTypeId(db, 1, 'Betreuungsvertrag'), title: 'Vertrag', documentDate: '2026-09-01', confidential: false,
    }, { data: markedPdf(), filename: 'scan.pdf' }, TODAY)
    const backup = async () => {
      const file = join(dir, 'backup.db')
      await createBackup(sqlite, file)
      return file
    }
    return { dataDir, db, sqlite, admin, upload, backup }
  }

  it('finds the marker while the document exists (the check itself works)', async () => {
    const { dataDir, db, sqlite, upload, backup } = open()
    upload(addChild(db, 1))
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toHaveLength(1)
    expect(hasMarker(await backup())).toBe(true)
    sqlite.close()
  })

  it('removes a deleted document from the file and from a later backup', async () => {
    const { dataDir, db, sqlite, admin, upload, backup } = open()
    const id = upload(addChild(db, 1))
    checkpointWal(sqlite)
    deleteDocument(db, admin, 1, id, TODAY)
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toEqual([])
    expect(hasMarker(await backup())).toBe(false)
    sqlite.close()
  })

  it('removes a deleted child with its documents', async () => {
    const { dataDir, db, sqlite, upload, backup } = open()
    const childId = addChild(db, 1)
    upload(childId)
    deleteChild(db, 1, childId)
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toEqual([])
    expect(hasMarker(await backup())).toBe(false)
    sqlite.close()
  })

  it('removes a deleted print template and the file a replacement superseded', async () => {
    const { dataDir, db, sqlite, admin, backup } = open()
    const leitung = { id: admin.id, role: admin.role, facilityId: 1 }
    const categoryId = createCategory(db, leitung, { name: 'Eltern', visibility: 'all' })
    const id = uploadTemplate(db, leitung, { title: 'Brief', categoryId, scope: 'facility' }, { data: markedPdf(), filename: 'b.pdf' })
    checkpointWal(sqlite)
    replaceTemplateFile(db, leitung, id, { data: Buffer.from('%PDF-1.7\nneu'), filename: 'b.pdf' })
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toEqual([])
    const again = uploadTemplate(db, leitung, { title: 'Brief', categoryId, scope: 'facility' }, { data: markedPdf(), filename: 'b.pdf' })
    checkpointWal(sqlite)
    deleteTemplate(db, leitung, again)
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toEqual([])
    expect(hasMarker(await backup())).toBe(false)
    sqlite.close()
  })

  it('removes a deleted personnel file document from the file and from a later backup', async () => {
    const { dataDir, db, sqlite, backup } = open()
    const traeger = addUser(db, 'traeger', 'provider')
    const id = uploadEmployeeDocument(db, traeger, 1, addEmployee(db, 'Anna'), {
      folder: 'measures', title: 'Abmahnung', documentDate: '2026-09-01', note: '',
    }, { data: markedPdf(), filename: 'a.pdf' })
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toHaveLength(1)
    deleteEmployeeDocument(db, traeger, 1, id)
    checkpointWal(sqlite)
    expect(databaseFilesWithMarker(dataDir)).toEqual([])
    expect(hasMarker(await backup())).toBe(false)
    sqlite.close()
  })
})
