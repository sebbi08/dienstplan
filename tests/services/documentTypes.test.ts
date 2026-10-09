import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDocuments } from '../../server/db/schema'
import {
  assertDocumentType, createDocumentType, deleteDocumentType, listDocumentTypes, updateDocumentType,
} from '../../server/services/documentTypes'
import { addChild, addFacility, createTestDb, documentTypeId, errorCode } from '../helpers/fixtures'

const input = (name: string, flags: Partial<{ important: boolean; required: boolean; confidentialDefault: boolean; sortOrder: number }> = {}) => ({
  name, important: false, required: false, confidentialDefault: false, sortOrder: 0, ...flags,
})

describe('document types of a facility', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('lists the seven default types in order', () => {
    const types = listDocumentTypes(db, 1)
    expect(types.map(type => type.name)).toEqual([
      'Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung',
      'Sorgerechtsbeschluss', 'Ärztliches Attest', 'Sonstiges',
    ])
    expect(types[0]).toMatchObject({ important: true, required: true, confidentialDefault: true })
  })

  it('creates a type at the end of the order', () => {
    const created = createDocumentType(db, 1, input('Fotoerlaubnis', { important: true }))
    expect(created).toMatchObject({ name: 'Fotoerlaubnis', important: true, required: false, confidentialDefault: false })
    const types = listDocumentTypes(db, 1)
    expect(types.at(-1)!.id).toBe(created.id)
    expect(created.sortOrder).toBeGreaterThan(types.at(-2)!.sortOrder)
  })

  it('trims the name and rejects an empty one', () => {
    expect(createDocumentType(db, 1, input('  Foto  ')).name).toBe('Foto')
    expect(errorCode(() => createDocumentType(db, 1, input('  ')))).toBe('document_type_name_required')
  })

  it('rejects a name another type uses, whatever the case', () => {
    expect(errorCode(() => createDocumentType(db, 1, input('masernnachweis')))).toBe('document_type_name_taken')
    expect(errorCode(() => createDocumentType(db, 1, input('ÄRZTLICHES ATTEST')))).toBe('document_type_name_taken')
    const other = addFacility(db, 'Andere Kita')
    createDocumentType(db, other, input('Fotoerlaubnis'))
    expect(errorCode(() => createDocumentType(db, 1, input('Fotoerlaubnis')))).toBeNull()
  })

  it('stores required only together with important', () => {
    expect(errorCode(() => createDocumentType(db, 1, input('A', { required: true })))).toBe('required_needs_important')
    expect(createDocumentType(db, 1, input('B', { important: true, required: true })).required).toBe(true)
    const type = createDocumentType(db, 1, input('C'))
    expect(errorCode(() => updateDocumentType(db, 1, type.id, input('C', { required: true })))).toBe('required_needs_important')
  })

  it('updates a type; keeping its own name is no clash', () => {
    const id = documentTypeId(db, 1, 'Sonstiges')
    const updated = updateDocumentType(db, 1, id, input('SONSTIGES', { important: true, confidentialDefault: true, sortOrder: 20 }))
    expect(updated).toEqual({ id, name: 'SONSTIGES', important: true, required: false, confidentialDefault: true, sortOrder: 20 })
    expect(listDocumentTypes(db, 1).at(-1)!.id).toBe(id)
    expect(errorCode(() => updateDocumentType(db, 1, id, input('Masernnachweis')))).toBe('document_type_name_taken')
    expect(errorCode(() => updateDocumentType(db, 1, id, input('')))).toBe('document_type_name_required')
  })

  it('treats another facility\'s type as not found', () => {
    const other = addFacility(db, 'Andere Kita')
    const foreign = documentTypeId(db, other, 'Sonstiges')
    expect(errorCode(() => updateDocumentType(db, 1, foreign, input('X')))).toBe('document_type_not_found')
    expect(errorCode(() => deleteDocumentType(db, 1, foreign))).toBe('document_type_not_found')
    expect(errorCode(() => assertDocumentType(db, 1, foreign))).toBe('document_type_not_found')
    expect(errorCode(() => assertDocumentType(db, 1, 99999))).toBe('document_type_not_found')
  })

  it('returns the type from the assertion', () => {
    const id = documentTypeId(db, 1, 'Sorgerechtsbeschluss')
    expect(assertDocumentType(db, 1, id)).toEqual({
      id, name: 'Sorgerechtsbeschluss', important: true, required: false, confidentialDefault: true,
      sortOrder: expect.any(Number),
    })
  })

  it('deletes an unused type', () => {
    const created = createDocumentType(db, 1, input('Foto'))
    deleteDocumentType(db, 1, created.id)
    expect(listDocumentTypes(db, 1).some(type => type.id === created.id)).toBe(false)
  })

  it('refuses to delete a type a document uses', () => {
    const id = documentTypeId(db, 1, 'Masernnachweis')
    const childId = addChild(db, 1)
    db.insert(childDocuments).values({
      childId, documentTypeId: id, mimeType: 'application/pdf', size: 4, data: Buffer.from('%PDF'),
      uploadedAt: '2026-10-08T00:00:00.000Z',
    }).run()
    expect(errorCode(() => deleteDocumentType(db, 1, id))).toBe('document_type_in_use')
    expect(listDocumentTypes(db, 1).some(type => type.id === id)).toBe(true)
  })
})
