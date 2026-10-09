import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childContacts, childDocuments, children, documentTypes } from '../../server/db/schema'
import { addChild, addFacility, createTestDb, documentTypeId } from '../helpers/fixtures'

const EXPECTED = [
  { name: 'Betreuungsvertrag', important: true, required: true, confidentialDefault: true, sortOrder: 0 },
  { name: 'Masernnachweis', important: true, required: true, confidentialDefault: false, sortOrder: 1 },
  { name: 'Belehrung Infektionsschutz', important: true, required: true, confidentialDefault: false, sortOrder: 2 },
  { name: 'Datenschutz-Einwilligung', important: true, required: true, confidentialDefault: false, sortOrder: 3 },
  { name: 'Sorgerechtsbeschluss', important: true, required: false, confidentialDefault: true, sortOrder: 4 },
  { name: 'Ärztliches Attest', important: false, required: false, confidentialDefault: true, sortOrder: 5 },
  { name: 'Sonstiges', important: false, required: false, confidentialDefault: false, sortOrder: 6 },
]

function typesOf(db: Db, facilityId: number) {
  return db.select({
    name: documentTypes.name, important: documentTypes.important, required: documentTypes.required,
    confidentialDefault: documentTypes.confidentialDefault, sortOrder: documentTypes.sortOrder,
  }).from(documentTypes).where(eq(documentTypes.facilityId, facilityId)).orderBy(documentTypes.sortOrder).all()
}

describe('child record schema', () => {
  it('gives facility 1 the seven default document types', () => {
    expect(typesOf(createTestDb(), 1)).toEqual(EXPECTED)
  })

  it('gives a new facility the seven default document types', () => {
    const db = createTestDb()
    const facility = addFacility(db, 'Kita 2')
    expect(typesOf(db, facility)).toEqual(EXPECTED)
    expect(documentTypeId(db, facility, 'Sonstiges')).not.toBe(documentTypeId(db, 1, 'Sonstiges'))
  })

  it('stores a child with defaults and cascades its contacts and documents on delete', () => {
    const db = createTestDb()
    const id = addChild(db, 1)
    const child = db.select().from(children).where(eq(children.id, id)).get()!
    expect(child).toMatchObject({
      lastName: 'Muster', firstName: 'Kind', birthDate: '2022-03-15', entryDate: '2025-09-01',
      leftOn: null, address: '', allergies: '',
    })
    expect(child.measlesProof).toBeNull()

    db.insert(childContacts).values({ childId: id, name: 'Mama' }).run()
    db.insert(childDocuments).values({
      childId: id, documentTypeId: documentTypeId(db, 1, 'Sonstiges'), mimeType: 'application/pdf', size: 3,
      data: Buffer.from([1, 2, 3]), uploadedAt: '2026-10-08T10:00:00.000Z',
    }).run()
    expect(db.select().from(childContacts).all()).toHaveLength(1)
    expect(db.select().from(childDocuments).all()).toHaveLength(1)

    db.delete(children).where(eq(children.id, id)).run()
    expect(db.select().from(childContacts).all()).toHaveLength(0)
    expect(db.select().from(childDocuments).all()).toHaveLength(0)
  })
})
