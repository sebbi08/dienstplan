import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childContacts, childDocuments, children, documentTypes } from '../../server/db/schema'
import { DEFAULT_DOCUMENT_TYPES } from '../../server/db/seed'
import { getChildRetentionYears, setChildRetentionYears } from '../../server/services/appSettings'
import { createCareType } from '../../server/services/careTypes'
import { addContact } from '../../server/services/childContacts'
import {
  deleteChild, deleteChildRecord, getChild, leaveChild, listArchive, moveChildToFacility, unleaveChild,
} from '../../server/services/children'
import { listDocumentTypes } from '../../server/services/documentTypes'
import type { ChildActor } from '../../server/lib/childViewer'
import {
  addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, documentTypeId, errorCode,
} from '../helpers/fixtures'

const TODAY = '2026-10-09'

function addDocument(db: Db, childId: number, typeId: number, title = 'Datei'): number {
  return db.insert(childDocuments).values({
    childId, documentTypeId: typeId, title, mimeType: 'application/pdf', size: 4, data: Buffer.from('%PDF'),
    uploadedAt: '2026-01-01T00:00:00.000Z',
  }).returning({ id: childDocuments.id }).get().id
}

function addRawContact(db: Db, childId: number): void {
  db.insert(childContacts).values({ childId, name: 'Anna', relation: 'Mutter' }).run()
}

describe('leaving, archive and automatic deletion of children', () => {
  let db: Db
  let admin: ChildActor
  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
  })

  const leftOnOf = (id: number) => db.select().from(children).where(eq(children.id, id)).get()!.leftOn

  describe('retention setting', () => {
    it('defaults to 3 years and stores whole years from 1 to 10', () => {
      expect(getChildRetentionYears(db)).toBe(3)
      setChildRetentionYears(db, 10)
      expect(getChildRetentionYears(db)).toBe(10)
      setChildRetentionYears(db, 1)
      expect(getChildRetentionYears(db)).toBe(1)
    })

    it.each([0, 11, 2.5, -3, Number.NaN])('refuses %s years', (years) => {
      setChildRetentionYears(db, 4)
      expect(errorCode(() => setChildRetentionYears(db, years))).toBe('invalid_retention')
      expect(getChildRetentionYears(db)).toBe(4)
    })
  })

  describe('leaving and the archive', () => {
    it('keeps the child active on the leaving day and archives it the day after', () => {
      const id = addChild(db, 1, { lastName: 'Meier', firstName: 'Lena' })
      leaveChild(db, 1, id, TODAY, TODAY)
      expect(getChild(db, admin, id, TODAY).status).toBe('active')
      expect(listArchive(db, 1, TODAY)).toEqual([])
      expect(getChild(db, admin, id, '2026-10-10').status).toBe('archived')
      expect(listArchive(db, 1, '2026-10-10')).toEqual([
        { id, name: 'Lena Meier', leftOn: TODAY, purgeOn: '2029-10-09' },
      ])
    })

    it('shows the purge date to managers only, and only for a child who has left', () => {
      const id = addChild(db, 1)
      const staff = asChildViewer(addUser(db, 'anna', 'observer', addEmployee(db, 'Anna')))
      expect(getChild(db, admin, id, TODAY).purgeOn).toBeNull()
      leaveChild(db, 1, id, TODAY, TODAY)
      expect(getChild(db, admin, id, TODAY).purgeOn).toBe('2029-10-09')
      expect(getChild(db, staff, id, TODAY).purgeOn).toBeNull()
      setChildRetentionYears(db, 5)
      expect(getChild(db, admin, id, TODAY).purgeOn).toBe('2031-10-09')
    })

    it('lists the archive of the facility only, the latest leaving first', () => {
      const krippe = addFacility(db, 'Krippe')
      const older = addChild(db, 1, { lastName: 'Alt', firstName: 'Anna', leftOn: '2026-01-31' })
      const newer = addChild(db, 1, { lastName: 'Neu', firstName: 'Ben', leftOn: '2026-09-30' })
      addChild(db, 1, { lastName: 'Aktiv', firstName: 'Carl' })
      addChild(db, krippe, { lastName: 'Fremd', firstName: 'Dora', leftOn: '2026-01-31' })
      expect(listArchive(db, 1, TODAY).map(child => child.id)).toEqual([newer, older])
    })

    it('accepts a leaving date up to one year in the past, not earlier', () => {
      const id = addChild(db, 1)
      expect(errorCode(() => leaveChild(db, 1, id, '2025-10-08', TODAY))).toBe('left_on_too_early')
      expect(leftOnOf(id)).toBeNull()
      leaveChild(db, 1, id, '2025-10-09', TODAY)
      expect(leftOnOf(id)).toBe('2025-10-09')
      leaveChild(db, 1, id, '2027-03-31', TODAY)
      expect(leftOnOf(id)).toBe('2027-03-31')
    })

    it('takes a leaving date back', () => {
      const id = addChild(db, 1, { leftOn: '2026-09-30' })
      expect(getChild(db, admin, id, TODAY).status).toBe('archived')
      unleaveChild(db, 1, id, TODAY)
      const record = getChild(db, admin, id, TODAY)
      expect(record.status).toBe('active')
      expect(record.leftOn).toBeNull()
      expect(record.purgeOn).toBeNull()
    })

    it('answers child_not_found for unknown children and those of another facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const foreign = addChild(db, krippe, { leftOn: '2026-01-31' })
      expect(errorCode(() => leaveChild(db, 1, foreign, TODAY, TODAY))).toBe('child_not_found')
      expect(errorCode(() => unleaveChild(db, 1, foreign, TODAY))).toBe('child_not_found')
      expect(errorCode(() => deleteChild(db, 1, foreign))).toBe('child_not_found')
      expect(errorCode(() => leaveChild(db, 1, 999, TODAY, TODAY))).toBe('child_not_found')
      expect(leftOnOf(foreign)).toBe('2026-01-31')
    })

    it('deletes a child at once with its contacts and documents', () => {
      const id = addChild(db, 1, { leftOn: '2026-09-30' })
      const other = addChild(db, 1)
      addContact(db, admin, 1, id, {
        name: 'Anna', relation: 'Mutter', phoneHome: '', phoneMobile: '1', phoneWork: '', isGuardian: true,
        mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '',
      }, '2026-09-01')
      const sonstiges = documentTypeId(db, 1, 'Sonstiges')
      const kept = addDocument(db, other, sonstiges)
      addDocument(db, id, sonstiges)
      deleteChild(db, 1, id)
      expect(db.select().from(children).all().map(row => row.id)).toEqual([other])
      expect(db.select().from(childContacts).all()).toEqual([])
      expect(db.select().from(childDocuments).all().map(row => row.id)).toEqual([kept])
    })

    it('lets only the Träger delete an archived record; the Leitung deletes waitlist, planned and active children', () => {
      const provider = asChildViewer(addUser(db, 'traeger', 'provider'))
      const archived = addChild(db, 1, { leftOn: '2026-09-30' })
      const leavingToday = addChild(db, 1, { leftOn: TODAY })
      const waitlist = addChild(db, 1, { admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-05-01' })
      const planned = addChild(db, 1, { entryDate: '2026-12-01' })
      const active = addChild(db, 1)
      expect(errorCode(() => deleteChildRecord(db, admin, 1, archived, TODAY))).toBe('archived_child_provider_only')
      expect(leftOnOf(archived)).toBe('2026-09-30')
      for (const id of [leavingToday, waitlist, planned, active]) deleteChildRecord(db, admin, 1, id, TODAY)
      deleteChildRecord(db, provider, 1, archived, TODAY)
      expect(db.select().from(children).all()).toEqual([])
      expect(errorCode(() => deleteChildRecord(db, admin, 1, 999, TODAY))).toBe('child_not_found')
    })
  })

  describe('moving to another facility', () => {
    const customType = (facilityId: number) =>
      db.insert(documentTypes).values({ facilityId, name: 'Fotoerlaubnis', sortOrder: 9 }).returning().get().id
    const typeOf = (docId: number) => db.select().from(childDocuments).where(eq(childDocuments.id, docId)).get()!.documentTypeId

    it('moves the record, clears group and care type and remaps the document types', () => {
      const krippe = addFacility(db, 'Krippe')
      const group = addGroup(db, 1, 'Mäuse')
      const careType = createCareType(db, 1, { name: 'Ganztag', start: 420, end: 960 }).id
      const id = addChild(db, 1, { groupId: group, careTypeId: careType })
      const measles = addDocument(db, id, documentTypeId(db, 1, 'Masernnachweis'))
      const unknown = addDocument(db, id, customType(1))
      addRawContact(db, id)

      moveChildToFacility(db, id, krippe)

      const row = db.select().from(children).where(eq(children.id, id)).get()!
      expect(row.facilityId).toBe(krippe)
      expect(row.groupId).toBeNull()
      expect(row.careTypeId).toBeNull()
      expect(typeOf(measles)).toBe(documentTypeId(db, krippe, 'Masernnachweis'))
      expect(typeOf(unknown)).toBe(documentTypeId(db, krippe, 'Sonstiges'))
      expect(db.select().from(childContacts).all()).toHaveLength(1)
      expect(listDocumentTypes(db, krippe)).toHaveLength(DEFAULT_DOCUMENT_TYPES.length)
    })

    it('creates "Sonstiges" with the default flags in a facility that lacks it', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(documentTypes).where(eq(documentTypes.id, documentTypeId(db, krippe, 'Sonstiges'))).run()
      const id = addChild(db, 1)
      const doc = addDocument(db, id, customType(1))

      moveChildToFacility(db, id, krippe)

      const others = listDocumentTypes(db, krippe).filter(type => type.name !== 'Sonstiges')
      const created = listDocumentTypes(db, krippe).find(type => type.name === 'Sonstiges')!
      const defaults = DEFAULT_DOCUMENT_TYPES.find(type => type.name === 'Sonstiges')!
      expect(created).toMatchObject({
        important: defaults.important, required: defaults.required, confidentialDefault: defaults.confidentialDefault,
      })
      expect(created.sortOrder).toBe(Math.max(...others.map(type => type.sortOrder)) + 1)
      expect(typeOf(doc)).toBe(created.id)
    })

    it('creates no "Sonstiges" when no document needs it', () => {
      const krippe = addFacility(db, 'Krippe')
      db.delete(documentTypes).where(eq(documentTypes.id, documentTypeId(db, krippe, 'Sonstiges'))).run()
      const id = addChild(db, 1)
      addDocument(db, id, documentTypeId(db, 1, 'Masernnachweis'))
      moveChildToFacility(db, id, krippe)
      expect(listDocumentTypes(db, krippe).map(type => type.name)).not.toContain('Sonstiges')
    })

    it('does nothing when the child is already there and answers 404 for unknown ids', () => {
      const group = addGroup(db, 1, 'Mäuse')
      const id = addChild(db, 1, { groupId: group })
      moveChildToFacility(db, id, 1)
      expect(db.select().from(children).where(eq(children.id, id)).get()!.groupId).toBe(group)
      expect(errorCode(() => moveChildToFacility(db, 999, 1))).toBe('child_not_found')
      expect(errorCode(() => moveChildToFacility(db, id, 999))).toBe('facility_not_found')
    })
  })
})
