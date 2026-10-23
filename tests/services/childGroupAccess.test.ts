import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childContacts, childDocuments, childGroupChanges, children, users } from '../../server/db/schema'
import type { ChildActor, ChildViewer } from '../../server/lib/childViewer'
import { ServiceError } from '../../server/lib/errors'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { addContact, deleteContact, reorderContacts, updateContact } from '../../server/services/childContacts'
import {
  deleteDocument, documentOverview, listDocuments, readDocumentFile, updateDocument, uploadDocument,
} from '../../server/services/childDocuments'
import { planGroupChange } from '../../server/services/childGroupChanges'
import {
  confirmSection, createChild, getChild, listBirthdays, listChildren, listOpenReviews, listPlanned, updateChildConsents,
  updateChildHealth, updateChildMaster,
} from '../../server/services/children'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { ChildContactInput, ChildDocumentMeta, SessionUser } from '../../shared/types/api'
import {
  addChild, addEmployee, addGroup, addUser, asChildViewer, createTestDb, documentTypeId,
} from '../helpers/fixtures'

const TODAY = '2026-10-06'
const NOW = new Date('2026-10-06T06:00:00Z')

const pdf = () => Buffer.from('%PDF-1.7\ncontent')
const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})

/** "<status> <code>" of the ServiceError fn throws, or null if it does not throw. */
function failure(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return `${error.statusCode} ${error.code}`
    throw error
  }
}

describe('child records by group rights', () => {
  let db: Db
  let tablet: SessionUser
  let admin: ChildActor
  let a: number
  let b: number
  let c: number
  let kidA: number
  let kidB: number
  let kidC: number
  let kidNone: number
  let planA: number
  let planC: number
  let token: string
  let docOf: Record<number, number>
  let contactOf: Record<number, number>
  let typeId: number

  /** The person at the tablet as the server sees them with this request (group A, read access to B, may edit children). */
  const viewer = () => resolveChildViewer(db, tablet, token, NOW) as ChildActor
  const meta = (): ChildDocumentMeta => ({ typeId, title: 'Vertrag', documentDate: '2026-09-01', confidential: false })
  /** The record as the Leitung sees it, to send its sections back unchanged. */
  const recordOf = (id: number) => getChild(db, admin, id, TODAY)

  beforeEach(() => {
    db = createTestDb()
    a = addGroup(db, 1, 'Bären')
    b = addGroup(db, 1, 'Mäuse')
    c = addGroup(db, 1, 'Füchse')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setTabletSettings(db, 1, { lockMinutes: 10, showWaitlist: true, showFutureContracts: true })
    tablet = addUser(db, 'tablet', 'terminal')
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    const anna = addEmployee(db, 'Anna', { groupId: a })
    setPin(db, 1, anna, '123456')
    const account = addUser(db, 'anna', 'observer', anna)
    db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
    setReadAccess(db, 1, a, [b])
    kidA = addChild(db, 1, { lastName: 'Amsel', groupId: a })
    kidB = addChild(db, 1, { lastName: 'Biber', groupId: b })
    kidC = addChild(db, 1, { lastName: 'Chamäleon', groupId: c })
    kidNone = addChild(db, 1, { lastName: 'Dachs', groupId: null })
    planA = addChild(db, 1, { lastName: 'Elch', groupId: a, entryDate: '2027-01-01' })
    planC = addChild(db, 1, { lastName: 'Fink', groupId: c, entryDate: '2027-01-01' })
    // Every active child has a section to confirm, so all of them would be "open".
    db.update(children).set({ contactsReviewSince: TODAY }).run()
    typeId = documentTypeId(db, 1, 'Betreuungsvertrag')
    docOf = {}
    contactOf = {}
    for (const id of [kidA, kidB, kidC, kidNone]) {
      docOf[id] = uploadDocument(db, admin, 1, id, meta(), { data: pdf(), filename: 'scan.pdf' }, TODAY, NOW)
      contactOf[id] = addContact(db, admin, 1, id, contact(), TODAY, NOW)
    }
    db.update(children).set({ contactsReviewSince: TODAY }).run()
    token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, anna, '123456', NOW).token
  })

  const listsOf = (who: ChildViewer) => ({
    children: listChildren(db, 1, 'active', TODAY, who.groups).map(item => item.id),
    birthdays: listBirthdays(db, 1, TODAY, who.groups).map(item => item.childId),
    open: listOpenReviews(db, 1, TODAY, who.groups).map(item => item.id),
    documents: documentOverview(db, who, 1, TODAY).rows.map(row => row.childId),
    planned: listPlanned(db, who, TODAY).contracted.map(item => item.id),
  })

  it('gives the tablet person the own group, the granted one and children without group in every list', () => {
    expect(viewer().groups).toEqual({ own: a, readable: [b] })
    const lists = listsOf(viewer())
    expect(lists.children.sort()).toEqual([kidA, kidB, kidNone].sort())
    expect(lists.birthdays.sort()).toEqual([kidA, kidB, kidNone].sort())
    expect(lists.open.sort()).toEqual([kidA, kidB, kidNone].sort())
    expect(lists.documents.sort()).toEqual([kidA, kidB, kidNone].sort())
    expect(lists.planned).toEqual([planA])
  })

  it('shows every child to a viewer without group access', () => {
    const lists = listsOf(admin)
    expect(lists.children.sort()).toEqual([kidA, kidB, kidC, kidNone].sort())
    expect(lists.birthdays.sort()).toEqual([kidA, kidB, kidC, kidNone].sort())
    expect(lists.open.sort()).toEqual([kidA, kidB, kidC, kidNone].sort())
    expect(lists.documents.sort()).toEqual([kidA, kidB, kidC, kidNone].sort())
    expect(lists.planned.sort()).toEqual([planA, planC].sort())
    expect(getChild(db, admin, kidC, TODAY).canEdit).toBe(true)
    expect(readDocumentFile(db, admin, 1, docOf[kidC]!, TODAY).data.equals(pdf())).toBe(true)
  })

  it('opens the own and ungrouped records for editing, a granted one read-only and hides every other', () => {
    expect(getChild(db, viewer(), kidA, TODAY).canEdit).toBe(true)
    expect(getChild(db, viewer(), kidNone, TODAY).canEdit).toBe(true)
    const granted = getChild(db, viewer(), kidB, TODAY)
    expect(granted.canEdit).toBe(false)
    expect(granted.contacts.map(item => item.id)).toEqual([contactOf[kidB]])
    expect(granted.documents.map(item => item.id)).toEqual([docOf[kidB]])
    expect(failure(() => getChild(db, viewer(), kidC, TODAY))).toBe('404 child_not_found')
    expect(failure(() => getChild(db, viewer(), planC, TODAY))).toBe('404 child_not_found')
    expect(failure(() => listDocuments(db, viewer(), 1, kidC, TODAY))).toBe('404 child_not_found')
  })

  it('hands out the files of the own, ungrouped and granted groups, never those of another group', () => {
    for (const id of [kidA, kidB, kidNone]) {
      expect(readDocumentFile(db, viewer(), 1, docOf[id]!, TODAY).data.equals(pdf())).toBe(true)
    }
    expect(failure(() => readDocumentFile(db, viewer(), 1, docOf[kidC]!, TODAY))).toBe('404 document_not_found')
  })

  /** Every write of a record, for the child `id` (its contact and document are the ones made in beforeEach). */
  const writes = (id: number): Record<string, () => unknown> => ({
    master: () => updateChildMaster(db, viewer(), 1, id, recordOf(id).master, TODAY, NOW),
    health: () => updateChildHealth(db, viewer(), 1, id, recordOf(id).health, TODAY, NOW),
    consents: () => updateChildConsents(db, viewer(), 1, id, recordOf(id).consents, TODAY, NOW),
    confirm: () => confirmSection(db, viewer(), 1, id, 'contacts', TODAY, NOW),
    reorderContacts: () => reorderContacts(db, viewer(), 1, id, [contactOf[id]!], TODAY, NOW),
    updateContact: () => updateContact(db, viewer(), 1, contactOf[id]!, contact({ name: 'Anders' }), TODAY, NOW),
    addContact: () => addContact(db, viewer(), 1, id, contact({ name: 'Neu' }), TODAY, NOW),
    deleteContact: () => deleteContact(db, viewer(), 1, contactOf[id]!, TODAY, NOW),
    upload: () => uploadDocument(db, viewer(), 1, id, meta(), { data: pdf(), filename: 'scan.pdf' }, TODAY, NOW),
    updateDocument: () => updateDocument(db, viewer(), 1, docOf[id]!, { ...meta(), title: 'Neu' }, TODAY),
    deleteDocument: () => deleteDocument(db, viewer(), 1, docOf[id]!, TODAY),
  })

  it('refuses every write on a granted group as read-only and changes nothing', () => {
    const before = {
      child: db.select().from(children).where(eq(children.id, kidB)).get(),
      contacts: db.select().from(childContacts).where(eq(childContacts.childId, kidB)).all(),
      documents: db.select({ id: childDocuments.id, title: childDocuments.title }).from(childDocuments)
        .where(eq(childDocuments.childId, kidB)).all(),
    }
    for (const [name, write] of Object.entries(writes(kidB))) {
      expect(failure(write), name).toBe('403 group_read_only')
    }
    expect(db.select().from(children).where(eq(children.id, kidB)).get()).toEqual(before.child)
    expect(db.select().from(childContacts).where(eq(childContacts.childId, kidB)).all()).toEqual(before.contacts)
    expect(db.select({ id: childDocuments.id, title: childDocuments.title }).from(childDocuments)
      .where(eq(childDocuments.childId, kidB)).all()).toEqual(before.documents)
  })

  it('answers every write on another group as if the record did not exist', () => {
    const expected: Record<string, string> = {
      updateContact: '404 contact_not_found', deleteContact: '404 contact_not_found',
      updateDocument: '404 document_not_found', deleteDocument: '404 document_not_found',
    }
    for (const [name, write] of Object.entries(writes(kidC))) {
      expect(failure(write), name).toBe(expected[name] ?? '404 child_not_found')
    }
  })

  it('lets the person write in the own group and for children without group', () => {
    for (const id of [kidA, kidNone]) {
      for (const [name, write] of Object.entries(writes(id))) {
        expect(failure(write), `${name} ${id}`).toBeNull()
      }
    }
  })

  it('hides a child moved out of the own group with the next request', () => {
    expect(getChild(db, viewer(), kidA, TODAY).canEdit).toBe(true)
    db.update(children).set({ groupId: c }).where(eq(children.id, kidA)).run()
    expect(failure(() => getChild(db, viewer(), kidA, TODAY))).toBe('404 child_not_found')
    expect(listChildren(db, 1, 'active', TODAY, viewer().groups).map(item => item.id)).not.toContain(kidA)
    expect(failure(() => readDocumentFile(db, viewer(), 1, docOf[kidA]!, TODAY))).toBe('404 document_not_found')
    expect(failure(() => updateChildHealth(db, viewer(), 1, kidA, recordOf(kidA).health, TODAY, NOW)))
      .toBe('404 child_not_found')
    // Moved into the granted group it can be read again, but not changed.
    db.update(children).set({ groupId: b }).where(eq(children.id, kidA)).run()
    expect(getChild(db, viewer(), kidA, TODAY).canEdit).toBe(false)
  })

  it('applies a withdrawn grant with the next request', () => {
    setReadAccess(db, 1, a, [])
    expect(failure(() => getChild(db, viewer(), kidB, TODAY))).toBe('404 child_not_found')
    expect(listChildren(db, 1, 'active', TODAY, viewer().groups).map(item => item.id)).not.toContain(kidB)
  })

  it('leaves a tablet person without group with every group, as before', () => {
    const berta = addEmployee(db, 'Berta')
    setPin(db, 1, berta, '123456')
    const account = addUser(db, 'berta', 'observer', berta)
    db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
    token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, berta, '123456', NOW).token
    expect(viewer().groups).toBeNull()
    expect(listsOf(viewer()).children.sort()).toEqual([kidA, kidB, kidC, kidNone].sort())
    expect(getChild(db, viewer(), kidC, TODAY).canEdit).toBe(true)
    expect(failure(writes(kidC).health!)).toBeNull()
  })

  it('hides a Vormerkung wishing for another group, shows one wishing for the own', () => {
    const wishA = addChild(db, 1, { lastName: 'Gans', groupId: a, entryDate: null, admissionStatus: 'waitlist', waitlistedOn: '2026-09-01' })
    const wishB = addChild(db, 1, { lastName: 'Hase', groupId: b, entryDate: null, admissionStatus: 'waitlist', waitlistedOn: '2026-09-02' })
    const wishC = addChild(db, 1, { lastName: 'Igel', groupId: c, entryDate: null, admissionStatus: 'waitlist', waitlistedOn: '2026-09-03' })
    expect(listPlanned(db, viewer(), TODAY).waitlist.map(item => item.id)).toEqual([wishA, wishB])
    expect(failure(() => getChild(db, viewer(), wishC, TODAY))).toBe('404 child_not_found')
    expect(listPlanned(db, admin, TODAY).waitlist.map(item => item.id)).toEqual([wishA, wishB, wishC])
  })

  describe('choosing a group', () => {
    const childCount = () => db.select({ id: children.id }).from(children).all().length
    const create = (groupId: number | null, who: ChildActor = viewer()) =>
      createChild(db, who, 1, { ...recordOf(kidA).master, lastName: 'Neu', groupId }, NOW)
    const saveGroup = (groupId: number | null) =>
      updateChildMaster(db, viewer(), 1, kidA, { ...recordOf(kidA).master, groupId, baseGroupId: a }, TODAY, NOW)
    const groupOf = (id: number) => db.select({ groupId: children.groupId }).from(children).where(eq(children.id, id)).get()!.groupId

    it('creates a child only in the own group or without group', () => {
      expect(groupOf(create(a))).toBe(a)
      expect(groupOf(create(null))).toBeNull()
      const before = childCount()
      expect(failure(() => create(b))).toBe('403 group_read_only')
      expect(failure(() => create(c))).toBe('404 group_not_found')
      expect(childCount()).toBe(before)
      // The Leitung creates in every group.
      expect(groupOf(create(c, admin))).toBe(c)
    })

    it('moves a child by its master data only into the own group or out of every group', () => {
      expect(failure(() => saveGroup(c))).toBe('404 group_not_found')
      expect(failure(() => saveGroup(b))).toBe('403 group_read_only')
      expect(groupOf(kidA)).toBe(a)
      expect(failure(() => saveGroup(a))).toBeNull()
      expect(groupOf(kidA)).toBe(a)
      expect(failure(() => saveGroup(null))).toBeNull()
      expect(groupOf(kidA)).toBeNull()
    })

    it('plans a group change only into a writable group', () => {
      const change = (groupId: number) => ({ groupId, date: '2026-11-02', keep: KEEP, newContract: false })
      expect(failure(() => planGroupChange(db, viewer(), 1, kidA, change(c), TODAY, NOW))).toBe('404 group_not_found')
      expect(failure(() => planGroupChange(db, viewer(), 1, kidA, change(b), TODAY, NOW))).toBe('403 group_read_only')
      expect(db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, kidA)).all()).toHaveLength(1)
      // The Leitung plans into every group.
      expect(failure(() => planGroupChange(db, admin, 1, kidA, change(c), TODAY, NOW))).toBeNull()
    })

    it('judges a write by the group a change due today gives the child', () => {
      db.insert(childGroupChanges).values({
        childId: kidA, groupId: c, fromDate: TODAY, createdAt: '2026-09-01T00:00:00.000Z', ...KEEP_COLUMNS,
      }).run()
      expect(groupOf(kidA)).toBe(a)
      expect(failure(writes(kidA).health!)).toBe('404 child_not_found')
      expect(failure(writes(kidA).upload!)).toBe('404 child_not_found')
      expect(failure(() => getChild(db, viewer(), kidA, TODAY))).toBe('404 child_not_found')
    })
  })
})

const KEEP = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }
const KEEP_COLUMNS = {
  keepContacts: true, keepHealth: true, keepConsents: true, keepDocuments: true, keepCareType: true, keepKeyEducator: true,
}
