import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { children } from '../../server/db/schema'
import { addContact, deleteContact, reorderContacts, updateContact } from '../../server/services/childContacts'
import { documentOverview, updateDocument, uploadDocument } from '../../server/services/childDocuments'
import { listDocumentTypes, updateDocumentType } from '../../server/services/documentTypes'
import { applyDueGroupChanges, planGroupChange } from '../../server/services/childGroupChanges'
import {
  confirmSection, getChild, listOpenReviews, updateChildConsents, updateChildHealth, updateChildMaster,
} from '../../server/services/children'
import type { ChildActor } from '../../server/lib/childViewer'
import {
  CONSENT_KEYS, KEEP_SECTIONS, type ChildConsents, type ChildContactInput, type ChildHealthInput, type ChildMasterInput,
  type GroupChangeInput, type KeepSection,
} from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, documentTypeId, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')
/** Before the markers of these tests (set by changes dated 2026-10-01). */
const EARLIER = new Date('2026-09-20T09:00:00.000Z')
const CHANGE_DAY = '2026-10-01'

const KEEP_ALL: Record<KeepSection, boolean> = {
  contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true,
}
const REVIEW_ALL: Record<KeepSection, boolean> = {
  contacts: false, health: false, consents: false, documents: false, careType: false, keyEducator: false,
}
const change = (groupId: number, date: string, keep: Partial<Record<KeepSection, boolean>> = {}): GroupChangeInput =>
  ({ groupId, date, keep: { ...KEEP_ALL, ...keep } })

const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})
const HEALTH: ChildHealthInput = {
  measlesProof: true, measlesProofDate: '2025-05-01', infectionBriefingDate: null, allergies: '',
  mayTakeTemperature: null, mayApplySunscreen: null, mayApplyPlaster: null,
}
const CONSENTS = Object.fromEntries(CONSENT_KEYS.map(key => [key, true])) as ChildConsents
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('content')])

describe('review markers after group changes', () => {
  let db: Db
  let admin: ChildActor
  let bears: number
  let mice: number
  let childId: number

  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    childId = addChild(db, 1, { groupId: bears })
  })

  const reviews = (id = childId) => getChild(db, admin, id, TODAY).reviews
  /** The child moves to the Mäuse on CHANGE_DAY; the sections not kept get their marker (the change is applied at once). */
  const moveWith = (keep: Partial<Record<KeepSection, boolean>>, id = childId) =>
    planGroupChange(db, admin, 1, id, change(mice, CHANGE_DAY, keep), TODAY, NOW)
  const saveMaster = (changes: Partial<ChildMasterInput> = {}) => {
    const master: ChildMasterInput = { ...getChild(db, admin, childId, TODAY).master, ...changes }
    updateChildMaster(db, admin, 1, childId, master, TODAY, NOW)
  }
  const stamps = () => getChild(db, admin, childId, TODAY).stamps

  describe('setting', () => {
    it('marks exactly the sections that are not kept, with the day of the change', () => {
      expect(reviews()).toEqual({})
      moveWith({ health: false, documents: false })
      expect(reviews()).toEqual({ health: CHANGE_DAY, documents: CHANGE_DAY })
    })

    it('marks a planned change on its day through the daily run', () => {
      planGroupChange(db, admin, 1, childId, change(mice, '2026-11-02', { consents: false }), TODAY, NOW)
      expect(reviews()).toEqual({})
      applyDueGroupChanges(db, '2026-11-02', new Date('2026-11-02T00:10:00.000Z'))
      expect(reviews()).toEqual({ consents: '2026-11-02' })
    })
  })

  describe('clearing by saving', () => {
    it('clears health when the health data are saved, and only that', () => {
      moveWith(REVIEW_ALL)
      updateChildHealth(db, admin, 1, childId, HEALTH, TODAY, NOW)
      expect(Object.keys(reviews())).toEqual(KEEP_SECTIONS.filter(section => section !== 'health'))
    })

    it('clears consents when the consents are saved, and only that', () => {
      moveWith(REVIEW_ALL)
      updateChildConsents(db, admin, 1, childId, CONSENTS, TODAY, NOW)
      expect(Object.keys(reviews())).toEqual(KEEP_SECTIONS.filter(section => section !== 'consents'))
    })

    it('clears contacts on every contact write', () => {
      const first = addContact(db, admin, 1, childId, contact(), TODAY, NOW)
      const second = addContact(db, admin, 1, childId, contact({ name: 'Bernd' }), TODAY, NOW)
      const mark = () => {
        db.update(children).set({ contactsReviewSince: CHANGE_DAY }).where(eq(children.id, childId)).run()
        expect(reviews()).toEqual({ contacts: CHANGE_DAY })
      }
      const writes = [
        () => updateContact(db, admin, 1, first, contact({ note: 'neu' }), TODAY, NOW),
        () => reorderContacts(db, admin, 1, childId, [second, first], TODAY, NOW),
        () => addContact(db, admin, 1, childId, contact({ name: 'Clara' }), TODAY, NOW),
        () => deleteContact(db, admin, 1, second, TODAY, NOW),
      ]
      moveWith({ contacts: false })
      for (const write of writes) {
        if (reviews().contacts === undefined) mark()
        write()
        expect(reviews()).toEqual({})
      }
    })

    it('clears care type and key educator with the master data, and nothing else', () => {
      moveWith(REVIEW_ALL)
      saveMaster({ note: 'Neu' })
      expect(Object.keys(reviews())).toEqual(['contacts', 'health', 'consents', 'documents'])
    })

    it('does not clear a marker when the save is refused', () => {
      moveWith(REVIEW_ALL)
      expect(errorCode(() => saveMaster({ lastName: '  ' }))).toBe('name_required')
      expect(Object.keys(reviews())).toHaveLength(6)
    })
  })

  describe('confirmSection', () => {
    it('clears the marker and stamps the section with the actor', () => {
      moveWith(REVIEW_ALL)
      confirmSection(db, admin, 1, childId, 'consents', TODAY, NOW)
      expect(Object.keys(reviews())).not.toContain('consents')
      expect(stamps().consents).toEqual({ updatedAt: NOW.toISOString(), updatedBy: 'leitung' })
      expect(stamps().health.updatedAt).toBeNull()
    })

    it('stamps the master data for care type and key educator', () => {
      moveWith(REVIEW_ALL)
      confirmSection(db, admin, 1, childId, 'keyEducator', TODAY, NOW)
      expect(Object.keys(reviews())).toEqual(KEEP_SECTIONS.filter(section => section !== 'keyEducator'))
      expect(stamps().master).toEqual({ updatedAt: NOW.toISOString(), updatedBy: 'leitung' })
      confirmSection(db, admin, 1, childId, 'careType', TODAY, NOW)
      expect(Object.keys(reviews())).toEqual(['contacts', 'health', 'consents', 'documents'])
    })

    it('is a no-op on a section without marker: no error, no stamp', () => {
      confirmSection(db, admin, 1, childId, 'consents', TODAY, NOW)
      confirmSection(db, admin, 1, childId, 'careType', TODAY, NOW)
      expect(reviews()).toEqual({})
      expect(stamps().consents.updatedAt).toBeNull()
      expect(stamps().master.updatedAt).toBeNull()
    })

    it('follows the usual write rules: other facility and unknown child 404, archived child 409 / 404', () => {
      const foreign = addChild(db, addFacility(db, 'Zweite'))
      const observer = asChildViewer(addUser(db, 'obs', 'observer', addEmployee(db, 'Obs')))
      expect(errorCode(() => confirmSection(db, admin, 1, foreign, 'health', TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => confirmSection(db, admin, 1, 9999, 'health', TODAY, NOW))).toBe('child_not_found')
      db.update(children).set({ leftOn: '2026-09-30', healthReviewSince: CHANGE_DAY }).where(eq(children.id, childId)).run()
      expect(errorCode(() => confirmSection(db, admin, 1, childId, 'health', TODAY, NOW))).toBe('child_archived')
      expect(errorCode(() => confirmSection(db, observer, 1, childId, 'health', TODAY, NOW))).toBe('child_not_found')
      expect(getChild(db, admin, childId, TODAY).reviews).toEqual({ health: CHANGE_DAY })
    })
  })

  describe('documents', () => {
    const REQUIRED = ['Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung']
    const upload = (name: string, now: Date, documentDate = '2026-09-01') => uploadDocument(
      db, admin, 1, childId,
      { typeId: documentTypeId(db, 1, name), title: name, documentDate, confidential: false },
      { data: pdf(), filename: 'scan.pdf' }, TODAY, now,
    )
    const row = () => documentOverview(db, admin, 1, TODAY).rows.find(item => item.childId === childId)!
    const stale = () => Object.fromEntries(REQUIRED.map(name => [name, row().cells[documentTypeId(db, 1, name)]?.stale]))

    beforeEach(() => {
      for (const name of REQUIRED) upload(name, EARLIER)
    })

    it('shows older documents as stale and counts them as missing while the marker is set', () => {
      expect(row().missingRequired).toBe(false)
      expect(stale()).toEqual({ Betreuungsvertrag: false, Masernnachweis: false, 'Belehrung Infektionsschutz': false, 'Datenschutz-Einwilligung': false })
      moveWith({ documents: false })
      expect(stale()).toEqual({ Betreuungsvertrag: true, Masernnachweis: true, 'Belehrung Infektionsschutz': true, 'Datenschutz-Einwilligung': true })
      expect(row().missingRequired).toBe(true)
    })

    it('does not mark missing cells or types that are not required as stale', () => {
      moveWith({ documents: false })
      upload('Sorgerechtsbeschluss', EARLIER)
      const cells = row().cells
      expect(cells[documentTypeId(db, 1, 'Sorgerechtsbeschluss')]?.stale).toBe(false)
    })

    it('clears the marker once every required type has a newer upload, then nothing is stale', () => {
      moveWith({ documents: false })
      upload('Betreuungsvertrag', NOW)
      upload('Masernnachweis', NOW)
      upload('Belehrung Infektionsschutz', NOW)
      expect(reviews()).toEqual({ documents: CHANGE_DAY })
      expect(stale()).toEqual({ Betreuungsvertrag: false, Masernnachweis: false, 'Belehrung Infektionsschutz': false, 'Datenschutz-Einwilligung': true })
      expect(row().missingRequired).toBe(true)
      // The document day does not matter, the upload day does.
      upload('Datenschutz-Einwilligung', NOW, '2025-01-01')
      expect(reviews()).toEqual({})
      expect(Object.values(stale())).toEqual([false, false, false, false])
      expect(row().missingRequired).toBe(false)
    })

    it('counts an upload on the marker day as new', () => {
      moveWith({ documents: false })
      for (const name of REQUIRED) upload(name, new Date(`${CHANGE_DAY}T00:00:00.000Z`))
      expect(reviews()).toEqual({})
    })

    it('is cleared at once by confirming the section', () => {
      moveWith({ documents: false })
      confirmSection(db, admin, 1, childId, 'documents', TODAY, NOW)
      expect(reviews()).toEqual({})
      expect(row().missingRequired).toBe(false)
    })

    it('leaves the marker alone when a required type of the facility is still without a new upload', () => {
      moveWith({ documents: false })
      upload('Datenschutz-Einwilligung', NOW)
      expect(reviews()).toEqual({ documents: CHANGE_DAY })
    })
  })

  describe('a documents marker nobody can act on', () => {
    const typeNamed = (name: string) => documentTypeId(db, 1, name)
    const setRequired = (required: boolean) => {
      for (const type of listDocumentTypes(db, 1).filter(item => item.required || !required)) {
        updateDocumentType(db, 1, type.id, { ...type, required, important: type.important })
      }
    }
    const storedMarker = () => childRow().documentsReviewSince
    const childRow = () => db.select().from(children).where(eq(children.id, childId)).get()!
    const upload = (name: string, now: Date) => uploadDocument(
      db, admin, 1, childId, { typeId: typeNamed(name), title: name, documentDate: '2026-09-01', confidential: false },
      { data: pdf(), filename: 'scan.pdf' }, TODAY, now,
    )

    it('is not even set for a facility without required types, and not reported when it is stored', () => {
      setRequired(false)
      moveWith({ documents: false, health: false })
      expect(storedMarker()).toBeNull()
      expect(reviews()).toEqual({ health: CHANGE_DAY })
      db.update(children).set({ documentsReviewSince: CHANGE_DAY, healthReviewSince: null }).where(eq(children.id, childId)).run()
      expect(reviews()).toEqual({})
      expect(listOpenReviews(db, 1, TODAY)).toEqual([])
    })

    it('is not set when every required type was uploaded since the change day already', () => {
      for (const name of ['Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung']) upload(name, NOW)
      moveWith({ documents: false })
      expect(storedMarker()).toBeNull()
    })

    it('disappears from the record and the list when the required flags are switched off, and is cleared by the next write', () => {
      moveWith({ documents: false })
      expect(reviews()).toEqual({ documents: CHANGE_DAY })
      expect(listOpenReviews(db, 1, TODAY).map(item => item.sections)).toEqual([['documents']])
      setRequired(false)
      expect(reviews()).toEqual({})
      expect(listOpenReviews(db, 1, TODAY)).toEqual([])
      expect(storedMarker()).toBe(CHANGE_DAY)
      upload('Sonstiges', NOW)
      expect(storedMarker()).toBeNull()
    })

    it('is cleared when a document is re-typed so that the last required type is complete', () => {
      for (const name of ['Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung']) upload(name, EARLIER)
      moveWith({ documents: false })
      for (const name of ['Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz']) upload(name, NOW)
      const misc = upload('Sonstiges', NOW)
      expect(storedMarker()).toBe(CHANGE_DAY)
      updateDocument(db, admin, 1, misc, {
        typeId: typeNamed('Datenschutz-Einwilligung'), title: 'Datenschutz', documentDate: '2026-09-01', confidential: false,
      }, TODAY)
      expect(storedMarker()).toBeNull()
    })

    it('counts a required type without any document as missing but not as stale in the overview', () => {
      upload('Betreuungsvertrag', EARLIER)
      moveWith({ documents: false })
      const row = documentOverview(db, admin, 1, TODAY).rows.find(item => item.childId === childId)!
      expect(row.cells[typeNamed('Betreuungsvertrag')]).toMatchObject({ stale: true })
      expect(row.cells[typeNamed('Masernnachweis')]).toBeNull()
      expect(row.missingRequired).toBe(true)
      // Only the missing types are left: no stale cell, but still missing.
      for (const name of ['Betreuungsvertrag']) upload(name, NOW)
      const after = documentOverview(db, admin, 1, TODAY).rows.find(item => item.childId === childId)!
      expect(after.cells[typeNamed('Betreuungsvertrag')]).toMatchObject({ stale: false })
      expect(after.cells[typeNamed('Masernnachweis')]).toBeNull()
      expect(after.missingRequired).toBe(true)
      expect(reviews()).toEqual({ documents: CHANGE_DAY })
    })
  })

  describe('writes after a due change the daily run has not applied yet', () => {
    const LATER = '2026-10-20'
    const LATER_NOW = new Date('2026-10-20T09:00:00.000Z')
    const stored = () => db.select().from(children).where(eq(children.id, childId)).get()!
    const reviewsLater = () => getChild(db, admin, childId, LATER).reviews

    beforeEach(() => {
      planGroupChange(db, admin, 1, childId, change(mice, LATER, REVIEW_ALL), TODAY, NOW)
      expect(stored().groupId).toBe(bears)
    })

    /** Afterwards the daily run has nothing left to do for the day and the saved section is not marked. */
    const expectSettledWithout = (section: KeepSection) => {
      expect(stored().groupId).toBe(mice)
      expect(applyDueGroupChanges(db, LATER, LATER_NOW)).toBe(0)
      const open = Object.keys(reviewsLater())
      expect(open).not.toContain(section)
      expect(open).toHaveLength(KEEP_SECTIONS.length - 1)
    }

    it('clears the health marker the due change sets', () => {
      updateChildHealth(db, admin, 1, childId, HEALTH, LATER, LATER_NOW)
      expectSettledWithout('health')
    })

    it('clears the consents marker the due change sets', () => {
      updateChildConsents(db, admin, 1, childId, CONSENTS, LATER, LATER_NOW)
      expectSettledWithout('consents')
    })

    it('clears the contacts marker with a contact write', () => {
      addContact(db, admin, 1, childId, contact(), LATER, LATER_NOW)
      expectSettledWithout('contacts')
    })

    it('clears care type and key educator with a master save that shows the group from before the change', () => {
      const master = getChild(db, admin, childId, LATER).master
      updateChildMaster(db, admin, 1, childId, { ...master, note: 'Neu' }, LATER, LATER_NOW)
      expect(stored().groupId).toBe(mice)
      expect(Object.keys(reviewsLater())).toEqual(['contacts', 'health', 'consents', 'documents'])
    })

    it('lets a confirmation clear a marker the due change sets', () => {
      confirmSection(db, admin, 1, childId, 'consents', LATER, LATER_NOW)
      expectSettledWithout('consents')
      expect(getChild(db, admin, childId, LATER).stamps.consents.updatedAt).toBe(LATER_NOW.toISOString())
    })

    it('judges an upload after the change: the marker is set first and cleared once every required type is there', () => {
      const names = ['Betreuungsvertrag', 'Masernnachweis', 'Belehrung Infektionsschutz', 'Datenschutz-Einwilligung']
      names.forEach((name, index) => {
        uploadDocument(db, admin, 1, childId, { typeId: documentTypeId(db, 1, name), title: name, documentDate: '2026-09-01', confidential: false },
          { data: pdf(), filename: 'scan.pdf' }, LATER, LATER_NOW)
        expect('documents' in reviewsLater()).toBe(index < names.length - 1)
      })
      expect(applyDueGroupChanges(db, LATER, LATER_NOW)).toBe(0)
      expect('documents' in reviewsLater()).toBe(false)
    })
  })

  describe('listOpenReviews', () => {
    it('lists active children with their open sections, sorted like the child list, and drops cleared ones', () => {
      const other = addChild(db, 1, { lastName: 'Adler', groupId: bears })
      const ungrouped = addChild(db, 1, { lastName: 'Zorn', groupId: null })
      addChild(db, 1, { lastName: 'Ohne' })
      moveWith({ health: false, contacts: false })
      moveWith({ consents: false }, other)
      db.update(children).set({ keyEducatorReviewSince: CHANGE_DAY }).where(eq(children.id, ungrouped)).run()
      expect(listOpenReviews(db, 1, TODAY)).toEqual([
        { id: other, name: 'Kind Adler', groupId: mice, sections: ['consents'] },
        { id: childId, name: 'Kind Muster', groupId: mice, sections: ['contacts', 'health'] },
        { id: ungrouped, name: 'Kind Zorn', groupId: null, sections: ['keyEducator'] },
      ])
      updateChildHealth(db, admin, 1, childId, HEALTH, TODAY, NOW)
      confirmSection(db, admin, 1, childId, 'contacts', TODAY, NOW)
      expect(listOpenReviews(db, 1, TODAY).map(item => item.id)).toEqual([other, ungrouped])
    })

    it('omits archived, planned and other facilities\' children', () => {
      const facility = addFacility(db, 'Zweite')
      const foreign = addChild(db, facility)
      const archived = addChild(db, 1, { leftOn: '2026-09-30' })
      const planned = addChild(db, 1, { entryDate: '2027-01-01' })
      for (const id of [foreign, archived, planned]) {
        db.update(children).set({ healthReviewSince: CHANGE_DAY }).where(eq(children.id, id)).run()
      }
      expect(listOpenReviews(db, 1, TODAY)).toEqual([])
      expect(listOpenReviews(db, facility, TODAY).map(item => item.id)).toEqual([foreign])
    })
  })
})
