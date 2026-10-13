import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges, children } from '../../server/db/schema'
import {
  applyDueGroupChanges, deleteGroupChange, planGroupChange, updateGroupChange,
} from '../../server/services/childGroupChanges'
import { documentOverview, uploadDocument } from '../../server/services/childDocuments'
import {
  confirmSection, createChild, getChild, leaveChild, listOpenReviews, moveChildToFacility, updateChildMaster,
} from '../../server/services/children'
import { listDocumentTypes, updateDocumentType } from '../../server/services/documentTypes'
import { deleteGroup, setGroupForSchoolChildren } from '../../server/services/groups'
import type { FacilityUser } from '../../server/utils/auth'
import type { ChildMasterInput, GroupChangeInput, KeepSection } from '../../shared/types/api'
import { addChild, addFacility, addGroup, addUser, createTestDb, documentTypeId, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')
const KEEP_ALL: Record<KeepSection, boolean> = {
  contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true,
}

/** `newContract` left out = the request does not say anything about a further care contract. */
const change = (
  groupId: number, date: string, keep: Partial<Record<KeepSection, boolean>> = {}, newContract?: boolean,
): GroupChangeInput =>
  ({ groupId, date, keep: { ...KEEP_ALL, ...keep }, ...(newContract === undefined ? {} : { newContract }) })

describe('group history and planned group changes', () => {
  let db: Db
  let admin: FacilityUser
  let bears: number
  let mice: number
  let owls: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin') as FacilityUser
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    owls = addGroup(db, 1, 'Eulen')
  })

  const childRow = (id: number) => db.select().from(children).where(eq(children.id, id)).get()!
  const groupOf = (id: number) => childRow(id).groupId
  /** The child's history in the order the domain gets it: [from, group, applied?]. */
  const history = (id: number) => db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, id))
    .orderBy(asc(childGroupChanges.fromDate), asc(childGroupChanges.id)).all()
    .map(row => [row.fromDate, row.groupId, row.appliedAt !== null])
  const pending = (id: number, today = TODAY) => getChild(db, admin, id, today).pendingGroupChange
  const reviewMarks = (id: number) => {
    const row = childRow(id)
    return {
      contacts: row.contactsReviewSince, health: row.healthReviewSince, consents: row.consentsReviewSince,
      documents: row.documentsReviewSince, careType: row.careTypeReviewSince, keyEducator: row.keyEducatorReviewSince,
    }
  }
  const NO_MARKS = { contacts: null, health: null, consents: null, documents: null, careType: null, keyEducator: null }
  /** Saves the master data as they are, with the given changes. */
  const saveMaster = (id: number, changes: Partial<ChildMasterInput>, today = TODAY, now = NOW) => {
    const master: ChildMasterInput = { ...getChild(db, admin, id, today).master, ...changes }
    updateChildMaster(db, admin, 1, id, master, today, now)
  }
  /** Saves the master data as they are, with another group. */
  const setGroup = (id: number, groupId: number | null, today = TODAY, now = NOW) => saveMaster(id, { groupId }, today, now)

  describe('planning', () => {
    it('keeps the group until the change day, then switches it exactly once', () => {
      const id = addChild(db, 1, { groupId: bears })
      expect(pending(id)).toBeNull()

      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15', { health: false }), TODAY, NOW)

      expect(groupOf(id)).toBe(bears)
      const planned = pending(id)!
      expect(planned).toEqual({
        id: planned.id, groupId: mice, groupName: 'Mäuse', date: '2027-03-15', keep: { ...KEEP_ALL, health: false }, newContract: false,
      })
      expect(history(id)).toEqual([[null, bears, true], ['2027-03-15', mice, false]])
      const stored = db.select().from(childGroupChanges).where(eq(childGroupChanges.id, planned.id)).get()!
      expect(stored).toMatchObject({ createdBy: admin.id, createdAt: NOW.toISOString(), appliedAt: null })

      expect(applyDueGroupChanges(db, '2027-03-14')).toBe(0)
      expect(groupOf(id)).toBe(bears)
      expect(reviewMarks(id)).toEqual(NO_MARKS)

      expect(applyDueGroupChanges(db, '2027-03-15', new Date('2027-03-15T00:10:00.000Z'))).toBe(1)
      expect(groupOf(id)).toBe(mice)
      expect(pending(id, '2027-03-15')).toBeNull()
      expect(history(id)).toEqual([[null, bears, true], ['2027-03-15', mice, true]])
      expect(db.select().from(childGroupChanges).where(eq(childGroupChanges.id, planned.id)).get()!.appliedAt)
        .toBe('2027-03-15T00:10:00.000Z')

      // A second run changes nothing, not even the time of applying.
      const before = { child: childRow(id), changes: db.select().from(childGroupChanges).all() }
      expect(applyDueGroupChanges(db, '2027-03-15', new Date('2027-03-15T01:10:00.000Z'))).toBe(0)
      expect(applyDueGroupChanges(db, '2027-03-16')).toBe(0)
      expect({ child: childRow(id), changes: db.select().from(childGroupChanges).all() }).toEqual(before)
    })

    it('applies a change dated today or in the past at once', () => {
      const today = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, today, change(mice, TODAY), TODAY, NOW)
      expect(groupOf(today)).toBe(mice)
      expect(pending(today)).toBeNull()
      expect(history(today)).toEqual([[null, bears, true], [TODAY, mice, true]])

      const past = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, past, change(owls, '2026-09-01', { contacts: false }), TODAY, NOW)
      expect(groupOf(past)).toBe(owls)
      expect(history(past)).toEqual([[null, bears, true], ['2026-09-01', owls, true]])
      expect(reviewMarks(past)).toEqual({ ...NO_MARKS, contacts: '2026-09-01' })
    })

    it('marks exactly the sections that are not kept as unconfirmed since the change day', () => {
      const id = addChild(db, 1, { groupId: bears })
      const keep = { contacts: false, health: true, consents: false, documents: false, careType: true, keyEducator: false }
      planGroupChange(db, admin, 1, id, change(mice, '2027-01-10', keep), TODAY, NOW)
      expect(reviewMarks(id)).toEqual(NO_MARKS)

      applyDueGroupChanges(db, '2027-01-12')

      expect(reviewMarks(id)).toEqual({
        contacts: '2027-01-10', health: null, consents: '2027-01-10', documents: '2027-01-10', careType: null,
        keyEducator: '2027-01-10',
      })

      // A later change that keeps everything leaves the open marks alone; one that does not moves them to its day.
      planGroupChange(db, admin, 1, id, change(owls, '2027-02-01'), '2027-01-12')
      applyDueGroupChanges(db, '2027-02-01')
      expect(reviewMarks(id).contacts).toBe('2027-01-10')
      planGroupChange(db, admin, 1, id, change(bears, '2027-03-01', { contacts: false }), '2027-02-01')
      applyDueGroupChanges(db, '2027-03-01')
      expect(reviewMarks(id)).toMatchObject({ contacts: '2027-03-01', consents: '2027-01-10' })
    })

    it('applies the due changes of every facility in one run and counts them', () => {
      const krippe = addFacility(db, 'Krippe')
      const wichtel = addGroup(db, krippe, 'Wichtel')
      const krippeAdmin = addUser(db, 'krippe', 'admin', null, krippe) as FacilityUser
      const a = addChild(db, 1, { groupId: bears })
      const b = addChild(db, 1, { groupId: bears })
      const c = addChild(db, krippe)
      const later = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, a, change(mice, '2026-11-01'), TODAY, NOW)
      planGroupChange(db, admin, 1, b, change(owls, '2026-12-01'), TODAY, NOW)
      planGroupChange(db, krippeAdmin, krippe, c, change(wichtel, '2026-11-15'), TODAY, NOW)
      planGroupChange(db, admin, 1, later, change(mice, '2027-01-01'), TODAY, NOW)

      expect(applyDueGroupChanges(db, '2026-12-01')).toBe(3)

      expect([a, b, c, later].map(groupOf)).toEqual([mice, owls, wichtel, bears])
    })

    it('refuses archived and waitlist children, foreign groups and unknown children', () => {
      const archived = addChild(db, 1, { groupId: bears, leftOn: '2026-10-01' })
      const waitlisted = addChild(db, 1, { groupId: bears, admissionStatus: 'waitlist', entryDate: null })
      const id = addChild(db, 1, { groupId: bears })
      const krippe = addFacility(db, 'Krippe')
      const foreignGroup = addGroup(db, krippe, 'Wichtel')
      const foreignChild = addChild(db, krippe)
      const staff = addUser(db, 'anna', 'observer', null, 1) as FacilityUser

      expect(errorCode(() => planGroupChange(db, admin, 1, archived, change(mice, '2027-01-01'), TODAY, NOW))).toBe('child_archived')
      expect(errorCode(() => planGroupChange(db, staff, 1, archived, change(mice, '2027-01-01'), TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => planGroupChange(db, admin, 1, waitlisted, change(mice, '2027-01-01'), TODAY, NOW)))
        .toBe('waitlist_no_group_change')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(foreignGroup, '2027-01-01'), TODAY, NOW))).toBe('group_not_found')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(999, '2027-01-01'), TODAY, NOW))).toBe('group_not_found')
      expect(errorCode(() => planGroupChange(db, admin, 1, foreignChild, change(mice, '2027-01-01'), TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => planGroupChange(db, admin, 1, 999, change(mice, '2027-01-01'), TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(mice, '2027-02-30'), TODAY, NOW))).toBe('invalid_date')
      expect(db.select().from(childGroupChanges).all().every(row => row.fromDate === null)).toBe(true)
    })

    it('refuses the group the child is in on that day', () => {
      const id = addChild(db, 1, { groupId: bears })
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(bears, '2027-01-01'), TODAY, NOW))).toBe('same_group')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(bears, TODAY), TODAY, NOW))).toBe('same_group')
      planGroupChange(db, admin, 1, id, change(mice, '2026-10-01'), TODAY, NOW)
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(mice, '2027-01-01'), TODAY, NOW))).toBe('same_group')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(bears, '2027-01-01'), TODAY, NOW))).toBeNull()
    })

    it('refuses a day that is not after the last applied change', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-10-01'), TODAY, NOW)
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(owls, '2026-10-01'), TODAY, NOW))).toBe('group_change_order')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(owls, '2026-09-15'), TODAY, NOW))).toBe('group_change_order')
      expect(history(id)).toEqual([[null, bears, true], ['2026-10-01', mice, true]])
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(owls, '2026-10-02'), TODAY, NOW))).toBeNull()
      expect(groupOf(id)).toBe(owls)
    })

    it('allows only one change that is not applied yet', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(owls, '2027-06-01'), TODAY, NOW))).toBe('group_change_pending')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(owls, TODAY), TODAY, NOW))).toBe('group_change_pending')
      expect(history(id)).toEqual([[null, bears, true], ['2027-03-15', mice, false]])
      // Once it is applied the next one can be planned.
      applyDueGroupChanges(db, '2027-03-15')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(owls, '2027-06-01'), '2027-03-15'))).toBeNull()
    })

    it('settles a due change of the child before judging the new one', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-11-01', { health: false }), TODAY, NOW)
      // The daily run has not come by yet on the change day.
      planGroupChange(db, admin, 1, id, change(owls, '2026-12-01'), '2026-11-01')
      expect(groupOf(id)).toBe(mice)
      expect(reviewMarks(id).health).toBe('2026-11-01')
      expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true], ['2026-12-01', owls, false]])
    })

    it('refuses a change day after the day the child leaves', () => {
      const id = addChild(db, 1, { groupId: bears, leftOn: '2027-07-31' })
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(mice, '2027-08-01'), TODAY, NOW)))
        .toBe('group_change_after_leaving')
      expect(errorCode(() => planGroupChange(db, admin, 1, id, change(mice, '2027-07-31'), TODAY, NOW))).toBeNull()
    })
  })

  describe('changing and deleting a planned change', () => {
    it('changes group, day and sections of a change that is not applied yet', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      const changeId = pending(id)!.id

      updateGroupChange(db, admin, 1, changeId, change(owls, '2027-04-01', { documents: false }), TODAY)

      expect(pending(id)).toEqual({
        id: changeId, groupId: owls, groupName: 'Eulen', date: '2027-04-01', keep: { ...KEEP_ALL, documents: false }, newContract: false,
      })
      expect(groupOf(id)).toBe(bears)
      expect(applyDueGroupChanges(db, '2027-03-15')).toBe(0)
      expect(applyDueGroupChanges(db, '2027-04-01')).toBe(1)
      expect(groupOf(id)).toBe(owls)
      expect(reviewMarks(id)).toEqual({ ...NO_MARKS, documents: '2027-04-01' })
    })

    it('applies a change at once when its day is moved to today or earlier', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      updateGroupChange(db, admin, 1, pending(id)!.id, change(mice, '2026-10-10'), TODAY)
      expect(groupOf(id)).toBe(mice)
      expect(pending(id)).toBeNull()
      expect(history(id)).toEqual([[null, bears, true], ['2026-10-10', mice, true]])
    })

    it('checks a changed change like a new one', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-10-01'), TODAY, NOW)
      planGroupChange(db, admin, 1, id, change(owls, '2027-03-15'), TODAY, NOW)
      const changeId = pending(id)!.id
      const foreignGroup = addGroup(db, addFacility(db, 'Krippe'), 'Wichtel')

      expect(errorCode(() => updateGroupChange(db, admin, 1, changeId, change(mice, '2027-03-15'), TODAY))).toBe('same_group')
      expect(errorCode(() => updateGroupChange(db, admin, 1, changeId, change(owls, '2026-10-01'), TODAY))).toBe('group_change_order')
      expect(errorCode(() => updateGroupChange(db, admin, 1, changeId, change(foreignGroup, '2027-03-15'), TODAY))).toBe('group_not_found')
      expect(errorCode(() => updateGroupChange(db, admin, 1, changeId, change(owls, '2027-02-30'), TODAY))).toBe('invalid_date')
      // Its own day and group are no obstacle.
      expect(errorCode(() => updateGroupChange(db, admin, 1, changeId, change(owls, '2027-03-15', { health: false }), TODAY))).toBeNull()
      expect(pending(id)).toMatchObject({ groupId: owls, date: '2027-03-15', keep: { health: false } })
    })

    it('refuses to change or delete an applied change and the start entry', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-10-01'), TODAY, NOW)
      const [start, applied] = db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, id))
        .orderBy(asc(childGroupChanges.fromDate)).all()

      for (const row of [start!, applied!]) {
        expect(errorCode(() => updateGroupChange(db, admin, 1, row.id, change(owls, '2027-01-01'), TODAY))).toBe('group_change_applied')
        expect(errorCode(() => deleteGroupChange(db, 1, row.id, TODAY))).toBe('group_change_applied')
      }
      expect(history(id)).toEqual([[null, bears, true], ['2026-10-01', mice, true]])
    })

    it('deletes a change that is not applied yet', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15', { health: false }), TODAY, NOW)

      // The day before the change is the last day it can be deleted.
      deleteGroupChange(db, 1, pending(id)!.id, '2027-03-14')

      expect(pending(id)).toBeNull()
      expect(history(id)).toEqual([[null, bears, true]])
      expect(applyDueGroupChanges(db, '2027-03-15')).toBe(0)
      expect(groupOf(id)).toBe(bears)
      expect(reviewMarks(id)).toEqual(NO_MARKS)
    })

    it('treats a change whose day has come as applied, even before the daily run', () => {
      const edited = addChild(db, 1, { groupId: bears })
      const deleted = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, edited, change(mice, '2026-11-01', { health: false }), TODAY, NOW)
      planGroupChange(db, admin, 1, deleted, change(mice, '2026-11-01', { health: false }), TODAY, NOW)
      const editedId = pending(edited)!.id
      const deletedId = pending(deleted)!.id
      const onTheDay = new Date('2026-11-01T00:20:00.000Z')

      expect(errorCode(() => updateGroupChange(db, admin, 1, editedId, change(owls, '2026-12-01'), '2026-11-01', onTheDay)))
        .toBe('group_change_applied')
      expect(errorCode(() => deleteGroupChange(db, 1, deletedId, '2026-11-01', onTheDay))).toBe('group_change_applied')

      // The change is settled by the refused request, not only refused.
      for (const id of [edited, deleted]) {
        expect(groupOf(id)).toBe(mice)
        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true]])
        expect(reviewMarks(id)).toEqual({ ...NO_MARKS, health: '2026-11-01' })
      }
      expect(db.select().from(childGroupChanges).where(eq(childGroupChanges.id, editedId)).get()!.appliedAt)
        .toBe(onTheDay.toISOString())
      expect(applyDueGroupChanges(db, '2026-11-01')).toBe(0)
    })

    it('refuses to move a planned change behind the leaving day or to change it for a waitlist child', () => {
      const leaving = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, leaving, change(mice, '2027-03-15'), TODAY, NOW)
      leaveChild(db, 1, leaving, '2027-07-31', TODAY)
      const leavingChange = pending(leaving)!.id
      expect(errorCode(() => updateGroupChange(db, admin, 1, leavingChange, change(mice, '2027-08-01'), TODAY)))
        .toBe('group_change_after_leaving')
      expect(pending(leaving)).toMatchObject({ date: '2027-03-15' })
      expect(errorCode(() => updateGroupChange(db, admin, 1, leavingChange, change(mice, '2027-07-31'), TODAY))).toBeNull()

      const waitlisted = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, waitlisted, change(mice, '2027-03-15'), TODAY, NOW)
      // The status gets there without the service that removes the change.
      db.update(children).set({ admissionStatus: 'waitlist', entryDate: null }).where(eq(children.id, waitlisted)).run()
      expect(errorCode(() => updateGroupChange(db, admin, 1, pending(waitlisted)!.id, change(owls, '2027-04-01'), TODAY)))
        .toBe('waitlist_no_group_change')
      expect(pending(waitlisted)).toMatchObject({ groupId: mice, date: '2027-03-15' })
    })

    it('answers group_change_not_found for unknown changes and those of another facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const krippeAdmin = addUser(db, 'krippe', 'admin', null, krippe) as FacilityUser
      const wichtel = addGroup(db, krippe, 'Wichtel')
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      const changeId = pending(id)!.id

      expect(errorCode(() => updateGroupChange(db, krippeAdmin, krippe, changeId, change(wichtel, '2027-04-01'), TODAY)))
        .toBe('group_change_not_found')
      expect(errorCode(() => deleteGroupChange(db, krippe, changeId, TODAY))).toBe('group_change_not_found')
      expect(errorCode(() => updateGroupChange(db, admin, 1, 999, change(owls, '2027-04-01'), TODAY))).toBe('group_change_not_found')
      expect(errorCode(() => deleteGroupChange(db, 1, 999, TODAY))).toBe('group_change_not_found')
      // Not even on its day is another facility's change touched.
      expect(errorCode(() => deleteGroupChange(db, krippe, changeId, '2027-03-15'))).toBe('group_change_not_found')
      expect(groupOf(id)).toBe(bears)
      expect(pending(id)).toMatchObject({ id: changeId, groupId: mice, date: '2027-03-15' })
    })

    it('refuses to change the planned change of an archived child', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      const changeId = pending(id)!.id
      db.update(children).set({ leftOn: '2026-10-01' }).where(eq(children.id, id)).run()
      expect(errorCode(() => updateGroupChange(db, admin, 1, changeId, change(owls, '2027-04-01'), TODAY))).toBe('child_archived')
    })
  })

  describe('children who leave', () => {
    it('deletes a planned change after the leaving day, which is then never applied', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-09-01', { health: false }), TODAY, NOW)

      leaveChild(db, 1, id, '2027-07-31', TODAY)

      expect(pending(id)).toBeNull()
      expect(history(id)).toEqual([[null, bears, true]])
      expect(applyDueGroupChanges(db, '2027-09-01')).toBe(0)
      expect(groupOf(id)).toBe(bears)
      expect(reviewMarks(id)).toEqual(NO_MARKS)
    })

    it('keeps a planned change on or before the leaving day and applies it', () => {
      const before = addChild(db, 1, { groupId: bears })
      const onTheDay = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, before, change(mice, '2027-03-15'), TODAY, NOW)
      planGroupChange(db, admin, 1, onTheDay, change(mice, '2027-07-31'), TODAY, NOW)
      leaveChild(db, 1, before, '2027-07-31', TODAY)
      leaveChild(db, 1, onTheDay, '2027-07-31', TODAY)

      expect(pending(before)).toMatchObject({ date: '2027-03-15' })
      expect(pending(onTheDay)).toMatchObject({ date: '2027-07-31' })
      expect(applyDueGroupChanges(db, '2027-08-15')).toBe(2)
      expect([before, onTheDay].map(groupOf)).toEqual([mice, mice])
    })

    it('never applies a change to a child who left before the change day', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-09-01'), TODAY, NOW)
      // The leaving day gets there without the service that removes the change.
      db.update(children).set({ leftOn: '2027-08-31' }).where(eq(children.id, id)).run()

      expect(applyDueGroupChanges(db, '2027-09-01')).toBe(0)
      expect(applyDueGroupChanges(db, '2028-01-01')).toBe(0)
      expect(groupOf(id)).toBe(bears)
      expect(history(id)).toEqual([[null, bears, true], ['2027-09-01', mice, false]])
    })
  })

  describe('changing the group in the master data', () => {
    it('gives a new child its start entry', () => {
      const id = createChild(db, admin, 1, {
        lastName: 'Meier', firstName: 'Lena', birthDate: '2024-03-15', address: '', groupId: bears, careTypeId: null,
        entryDate: '2026-09-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
        schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null,
      }, NOW)
      expect(db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, id)).all()).toEqual([expect.objectContaining({
        groupId: bears, fromDate: null, appliedAt: NOW.toISOString(), createdAt: NOW.toISOString(), createdBy: admin.id,
        keepContacts: true, keepHealth: true, keepConsents: true, keepDocuments: true, keepCareType: true, keepKeyEducator: true,
      })])
      expect(pending(id)).toBeNull()
    })

    it('only changes the start group of a child that has not started', () => {
      const waitlisted = addChild(db, 1, { groupId: bears, admissionStatus: 'waitlist', entryDate: null, plannedEntryDate: '2026-01-01' })
      const future = addChild(db, 1, { groupId: bears, entryDate: '2026-10-14' })
      const futurePlanned = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: '2027-02-01' })
      const undated = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: null })
      for (const id of [waitlisted, future, futurePlanned, undated]) {
        setGroup(id, mice)
        expect(groupOf(id)).toBe(mice)
        expect(history(id)).toEqual([[null, mice, true]])
        setGroup(id, null)
        expect(history(id)).toEqual([[null, null, true]])
      }
    })

    it('records a change dated today for a child that has started, keeping every section', () => {
      const entered = addChild(db, 1, { groupId: bears, entryDate: TODAY })
      const plannedStartReached = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: '2026-10-01' })
      for (const id of [entered, plannedStartReached]) {
        setGroup(id, mice)
        expect(groupOf(id)).toBe(mice)
        expect(history(id)).toEqual([[null, bears, true], [TODAY, mice, true]])
        expect(reviewMarks(id)).toEqual(NO_MARKS)
        expect(pending(id)).toBeNull()
      }
      const stored = db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, entered)).all()
        .find(row => row.fromDate === TODAY)!
      expect(stored).toMatchObject({
        createdBy: admin.id, appliedAt: NOW.toISOString(), keepContacts: true, keepHealth: true, keepConsents: true,
        keepDocuments: true, keepCareType: true, keepKeyEducator: true,
      })
    })

    it('judges whether the child has started on the stored record, not on what is saved with the group', () => {
      // A Vormerkung becomes a contract with a backdated entry and another group in one save: it never was in the wish group.
      const waitlisted = addChild(db, 1, { groupId: bears, admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-05-04' })
      saveMaster(waitlisted, { admissionStatus: 'contract', entryDate: '2026-10-01', groupId: mice })
      expect(history(waitlisted)).toEqual([[null, mice, true]])
      expect(groupOf(waitlisted)).toBe(mice)

      // A future entry day is moved into the past together with the group.
      const future = addChild(db, 1, { groupId: bears, entryDate: '2027-01-01' })
      saveMaster(future, { entryDate: '2026-10-01', groupId: mice })
      expect(history(future)).toEqual([[null, mice, true]])
      expect(groupOf(future)).toBe(mice)
      // From then on it has started: the next change is dated.
      saveMaster(future, { groupId: owls })
      expect(history(future)).toEqual([[null, mice, true], [TODAY, owls, true]])

      // The other way round: a child that has started keeps its past, whatever entry day is saved with the group.
      const started = addChild(db, 1, { groupId: bears, entryDate: '2026-09-01' })
      saveMaster(started, { entryDate: '2027-01-01', groupId: mice })
      expect(history(started)).toEqual([[null, bears, true], [TODAY, mice, true]])
    })

    it('never rewrites the start group of a child that has started by making it a Vormerkung', () => {
      const id = addChild(db, 1, { groupId: bears, entryDate: '2026-09-01' })
      expect(errorCode(() => saveMaster(id, { admissionStatus: 'waitlist', entryDate: null, groupId: mice })))
        .toBe('waitlist_after_start')
      expect(history(id)).toEqual([[null, bears, true]])
      expect(childRow(id)).toMatchObject({ admissionStatus: 'contract', entryDate: '2026-09-01', groupId: bears })
    })

    it('deletes a planned change when the child becomes a Vormerkung, so it is never applied', () => {
      const id = addChild(db, 1, { groupId: bears, entryDate: '2027-01-01' })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15', { health: false }), TODAY, NOW)
      const other = addChild(db, 1, { groupId: bears, entryDate: '2027-01-01' })
      planGroupChange(db, admin, 1, other, change(mice, '2027-03-15'), TODAY, NOW)

      saveMaster(id, { admissionStatus: 'waitlist', entryDate: null, plannedEntryDate: '2027-01-01' })

      expect(pending(id)).toBeNull()
      expect(history(id)).toEqual([[null, bears, true]])
      // Only this child's change is gone.
      expect(applyDueGroupChanges(db, '2027-03-15')).toBe(1)
      expect([id, other].map(groupOf)).toEqual([bears, mice])
      expect(reviewMarks(id)).toEqual(NO_MARKS)
    })

    it('keeps the planned change of a Vormerkung-free save', () => {
      const id = addChild(db, 1, { groupId: bears, entryDate: '2027-01-01' })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      saveMaster(id, { note: 'Geschwisterkind' })
      expect(pending(id)).toMatchObject({ groupId: mice, date: '2027-03-15' })
    })

    it('records a dated change for a child that has not started but already has an applied change', () => {
      const id = addChild(db, 1, { groupId: bears, entryDate: '2027-01-01' })
      planGroupChange(db, admin, 1, id, change(mice, '2026-10-01'), TODAY, NOW)
      setGroup(id, owls)
      expect(history(id)).toEqual([[null, bears, true], ['2026-10-01', mice, true], [TODAY, owls, true]])
    })

    it('leaves the history alone when the group stays the same', () => {
      const id = addChild(db, 1, { groupId: bears })
      setGroup(id, bears)
      expect(history(id)).toEqual([[null, bears, true]])
    })

    it('keeps one entry per day: a second change on the same day replaces the first', () => {
      const id = addChild(db, 1, { groupId: bears })
      setGroup(id, mice)
      setGroup(id, owls)
      expect(history(id)).toEqual([[null, bears, true], [TODAY, owls, true]])
      expect(groupOf(id)).toBe(owls)
      setGroup(id, null)
      expect(history(id)).toEqual([[null, bears, true], [TODAY, null, true]])
      // The next day gets its own entry.
      setGroup(id, mice, '2026-10-14')
      expect(history(id)).toEqual([[null, bears, true], [TODAY, null, true], ['2026-10-14', mice, true]])
    })

    it('replaces the entry of a planned change applied on the same day and keeps its marks', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, TODAY, { health: false }), TODAY, NOW)
      setGroup(id, owls)
      expect(history(id)).toEqual([[null, bears, true], [TODAY, owls, true]])
      expect(reviewMarks(id)).toEqual({ ...NO_MARKS, health: TODAY })
    })

    it('settles a due change first, so the change day still has one entry and the marks are set', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-11-01', { health: false }), TODAY, NOW)
      // On the change day, before the daily run: the form still shows the old group and another one is chosen.
      setGroup(id, owls, '2026-11-01')
      expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', owls, true]])
      expect(groupOf(id)).toBe(owls)
      expect(reviewMarks(id).health).toBe('2026-11-01')
      expect(applyDueGroupChanges(db, '2026-11-01')).toBe(0)
    })

    it('does not undo a due change when the master data are saved with the group shown before the daily run', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-11-01'), TODAY, NOW)
      setGroup(id, bears, '2026-11-01')
      // The save settles the due change first (so it clears the markers the change sets); the group is not undone.
      expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true]])
      expect(groupOf(id)).toBe(mice)
      expect(applyDueGroupChanges(db, '2026-11-01')).toBe(0)
      expect(groupOf(id)).toBe(mice)
    })

    describe('saved from a form that was loaded before a planned change was applied', () => {
      /** Loaded on 13 October with the Bären; the planned change into the Mäuse is applied by the daily run of 1 November. */
      const staleForm = () => {
        const id = addChild(db, 1, { groupId: bears })
        planGroupChange(db, admin, 1, id, change(mice, '2026-11-01', { health: false }), TODAY, NOW)
        const loaded = getChild(db, admin, id, TODAY).master
        expect(applyDueGroupChanges(db, '2026-11-01')).toBe(1)
        return { id, loaded }
      }
      const LATER = new Date('2026-11-02T08:30:00.000Z')

      it('does not undo the applied change: the group the form was loaded with is no direct change', () => {
        const { id, loaded } = staleForm()

        updateChildMaster(db, admin, 1, id, { ...loaded, note: 'Geschwisterkind', baseGroupId: loaded.groupId }, '2026-11-02', LATER)

        expect(groupOf(id)).toBe(mice)
        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true]])
        expect(getChild(db, admin, id, '2026-11-02').master).toMatchObject({ groupId: mice, note: 'Geschwisterkind' })
        // The marker the change set is still there: the master data do not confirm the health section.
        expect(reviewMarks(id).health).toBe('2026-11-01')
      })

      it('still saves when the group the form was loaded with has been deleted since', () => {
        const { id, loaded } = staleForm()
        deleteGroup(db, 1, bears, '2026-11-02')

        updateChildMaster(db, admin, 1, id, { ...loaded, note: 'neu', baseGroupId: loaded.groupId }, '2026-11-02', LATER)

        expect(childRow(id)).toMatchObject({ groupId: mice, note: 'neu' })
      })

      it('takes another group than the loaded one as a direct change from the stored group', () => {
        const { id, loaded } = staleForm()

        updateChildMaster(db, admin, 1, id, { ...loaded, groupId: owls, baseGroupId: loaded.groupId }, '2026-11-02', LATER)

        expect(groupOf(id)).toBe(owls)
        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true], ['2026-11-02', owls, true]])
      })

      it('leaves the history alone when the stored group is chosen on the stale form', () => {
        const { id, loaded } = staleForm()
        updateChildMaster(db, admin, 1, id, { ...loaded, groupId: mice, baseGroupId: loaded.groupId }, '2026-11-02', LATER)
        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true]])
      })

      it('judges a save that does not name the loaded group against the stored one', () => {
        const { id, loaded } = staleForm()
        updateChildMaster(db, admin, 1, id, { ...loaded, groupId: mice }, '2026-11-02', LATER)
        expect(history(id)).toEqual([[null, bears, true], ['2026-11-01', mice, true]])
        updateChildMaster(db, admin, 1, id, { ...loaded, groupId: owls }, '2026-11-02', LATER)
        expect(groupOf(id)).toBe(owls)
      })
    })

    it('leaves a planned change to the same group on a later day untouched', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15', { health: false }), TODAY, NOW)
      const planned = pending(id)

      setGroup(id, mice)

      expect(pending(id)).toEqual(planned)
      expect(history(id)).toEqual([[null, bears, true], [TODAY, mice, true], ['2027-03-15', mice, false]])
      // The planned change is still applied on its day, with its marks.
      expect(applyDueGroupChanges(db, '2027-03-15')).toBe(1)
      expect(groupOf(id)).toBe(mice)
      expect(reviewMarks(id).health).toBe('2027-03-15')
    })
  })

  describe('moving to another facility', () => {
    it('ends the history with no group from today and removes a planned change', () => {
      const krippe = addFacility(db, 'Krippe')
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2026-10-01'), TODAY, NOW)
      planGroupChange(db, admin, 1, id, change(owls, '2027-03-15'), TODAY, NOW)

      moveChildToFacility(db, id, krippe, NOW)

      expect(history(id)).toEqual([[null, bears, true], ['2026-10-01', mice, true], [TODAY, null, true]])
      expect(groupOf(id)).toBeNull()
      expect(applyDueGroupChanges(db, '2027-03-15')).toBe(0)
      expect(groupOf(id)).toBeNull()
    })

    it('replaces the entry of a change applied on the day of the move', () => {
      const krippe = addFacility(db, 'Krippe')
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, TODAY), TODAY, NOW)
      moveChildToFacility(db, id, krippe, NOW)
      expect(history(id)).toEqual([[null, bears, true], [TODAY, null, true]])
    })

    it('leaves the history alone when the child is already there', () => {
      const id = addChild(db, 1, { groupId: bears })
      planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
      moveChildToFacility(db, id, 1, NOW)
      expect(history(id)).toEqual([[null, bears, true], ['2027-03-15', mice, false]])
    })
  })

  describe('groups for school children', () => {
    /** Before the change day of the marker tests. */
    const EARLIER = new Date('2026-09-20T09:00:00.000Z')
    const CHANGE_DAY = '2026-10-01'
    let hort: number
    beforeEach(() => {
      hort = addGroup(db, 1, 'Hort')
      setGroupForSchoolChildren(db, hort, true)
    })

    const contractMark = (id: number) => childRow(id).contractReviewSince
    /** Per history entry whether it carries the further care contract. */
    const newContracts = (id: number) => db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, id))
      .orderBy(asc(childGroupChanges.fromDate), asc(childGroupChanges.id)).all().map(row => row.newContract)
    const plan = (id: number, input: GroupChangeInput) => planGroupChange(db, admin, 1, id, input, TODAY, NOW)

    describe('planning', () => {
      it('refuses a change into such a group unless the further care contract is confirmed', () => {
        const id = addChild(db, 1, { groupId: bears })

        expect(errorCode(() => plan(id, change(hort, '2027-09-01')))).toBe('new_contract_required')
        expect(errorCode(() => plan(id, change(hort, '2027-09-01', {}, false)))).toBe('new_contract_required')
        expect(errorCode(() => plan(id, change(hort, TODAY)))).toBe('new_contract_required')
        expect(history(id)).toEqual([[null, bears, true]])
        expect(groupOf(id)).toBe(bears)

        plan(id, change(hort, '2027-09-01', {}, true))
        expect(pending(id)).toMatchObject({ groupId: hort, groupName: 'Hort', date: '2027-09-01', newContract: true })
        expect(newContracts(id)).toEqual([false, true])
      })

      it('marks the care contract as not confirmed since the change day when the change is applied, and nothing else', () => {
        const id = addChild(db, 1, { groupId: bears })
        plan(id, change(hort, '2027-09-01', {}, true))
        expect(contractMark(id)).toBeNull()

        expect(applyDueGroupChanges(db, '2027-08-31')).toBe(0)
        expect(contractMark(id)).toBeNull()

        expect(applyDueGroupChanges(db, '2027-09-03', new Date('2027-09-03T00:10:00.000Z'))).toBe(1)
        expect(groupOf(id)).toBe(hort)
        expect(contractMark(id)).toBe('2027-09-01')
        expect(reviewMarks(id)).toEqual(NO_MARKS)
        expect(getChild(db, admin, id, '2027-09-03').reviews).toEqual({ contract: '2027-09-01' })
      })

      it('applies a change dated today at once, with the marker next to those of the sections not kept', () => {
        const id = addChild(db, 1, { groupId: bears })
        plan(id, change(hort, TODAY, { health: false }, true))
        expect(groupOf(id)).toBe(hort)
        expect(getChild(db, admin, id, TODAY).reviews).toEqual({ health: TODAY, contract: TODAY })
      })

      it('sets no contract marker for a change into another group, whatever the request says', () => {
        const id = addChild(db, 1, { groupId: bears })
        plan(id, change(mice, TODAY, {}, true))
        expect(groupOf(id)).toBe(mice)
        expect(newContracts(id)).toEqual([false, false])
        expect(contractMark(id)).toBeNull()
      })

      it('asks for the contract again when a planned change is moved into such a group, and drops it when moved out', () => {
        const id = addChild(db, 1, { groupId: bears })
        plan(id, change(mice, '2027-03-15'))
        const planned = pending(id)!
        const update = (input: GroupChangeInput) => updateGroupChange(db, admin, 1, planned.id, input, TODAY, NOW)

        expect(errorCode(() => update(change(hort, '2027-03-15')))).toBe('new_contract_required')
        expect(pending(id)).toMatchObject({ groupId: mice })
        update(change(hort, '2027-03-15', {}, true))
        expect(pending(id)).toMatchObject({ groupId: hort })
        expect(newContracts(id)).toEqual([false, true])
        // Changing only the day needs the confirmation again: the change still leads into the group.
        expect(errorCode(() => update(change(hort, '2027-04-01')))).toBe('new_contract_required')

        update(change(owls, '2027-03-15', {}, true))
        expect(newContracts(id)).toEqual([false, false])
        expect(applyDueGroupChanges(db, '2027-03-15')).toBe(1)
        expect(contractMark(id)).toBeNull()
      })

      it('lets a group that is no longer flagged be planned like any other', () => {
        const id = addChild(db, 1, { groupId: bears })
        setGroupForSchoolChildren(db, hort, false)
        plan(id, change(hort, TODAY))
        expect(groupOf(id)).toBe(hort)
        expect(contractMark(id)).toBeNull()
      })

      it('sets the marker by what the group is when the change is applied, not when it was planned', () => {
        // Planned while the Eulen were an ordinary group; they are for school children by the change day.
        const flaggedLater = addChild(db, 1, { groupId: bears })
        plan(flaggedLater, change(owls, '2027-09-01'))
        // Planned with the further contract; the Hort is an ordinary group by the change day.
        const unflaggedLater = addChild(db, 1, { groupId: bears })
        plan(unflaggedLater, change(hort, '2027-09-01', {}, true))
        expect(pending(flaggedLater)).toMatchObject({ newContract: false })
        expect(pending(unflaggedLater)).toMatchObject({ newContract: true })
        setGroupForSchoolChildren(db, owls, true)
        setGroupForSchoolChildren(db, hort, false)

        expect(applyDueGroupChanges(db, '2027-09-01')).toBe(2)

        expect([groupOf(flaggedLater), contractMark(flaggedLater)]).toEqual([owls, '2027-09-01'])
        expect([groupOf(unflaggedLater), contractMark(unflaggedLater)]).toEqual([hort, null])
      })
    })

    describe('changing the group in the master data', () => {
      it('refuses to move a child that has started into such a group and saves nothing', () => {
        const id = addChild(db, 1, { groupId: bears })

        expect(errorCode(() => saveMaster(id, { groupId: hort, note: 'Hort ab Herbst' }))).toBe('new_contract_required')

        expect(groupOf(id)).toBe(bears)
        expect(history(id)).toEqual([[null, bears, true]])
        expect(getChild(db, admin, id, TODAY).master.note).toBe('')
        // Out of such a group the direct change stays possible.
        const inHort = addChild(db, 1, { groupId: hort })
        setGroup(inHort, bears)
        expect(history(inHort)).toEqual([[null, hort, true], [TODAY, bears, true]])
      })

      it('refuses it for a child that has not started but already has an applied change', () => {
        const id = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: '2027-01-01' })
        plan(id, change(mice, '2026-10-01'))
        expect(errorCode(() => setGroup(id, hort))).toBe('new_contract_required')
        expect(groupOf(id)).toBe(mice)
      })

      it('lets a child that has not started get such a group as its start group, without a marker', () => {
        const planned = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: '2027-01-01' })
        setGroup(planned, hort)
        expect(history(planned)).toEqual([[null, hort, true]])
        expect(contractMark(planned)).toBeNull()

        const created = createChild(db, admin, 1, { ...getChild(db, admin, planned, TODAY).master, firstName: 'Neu', groupId: hort }, NOW)
        expect(history(created)).toEqual([[null, hort, true]])
        expect(contractMark(created)).toBeNull()
      })
    })

    describe('the care contract marker', () => {
      const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('content')])
      let id: number
      const upload = (name: string, now: Date) => uploadDocument(
        db, admin, 1, id, { typeId: documentTypeId(db, 1, name), title: name, documentDate: '2026-09-01', confidential: false },
        { data: pdf(), filename: 'scan.pdf' }, TODAY, now,
      )
      const overviewRow = () => documentOverview(db, admin, 1, TODAY).rows.find(item => item.childId === id)!
      const stale = (name: string) => overviewRow().cells[documentTypeId(db, 1, name)]?.stale
      const reviews = () => getChild(db, admin, id, TODAY).reviews
      const flagAsContract = (name: string, careContract: boolean) => {
        const type = listDocumentTypes(db, 1).find(item => item.name === name)!
        updateDocumentType(db, 1, type.id, { ...type, careContract })
      }

      /** The child has its documents from before the change and moves to the Hort on CHANGE_DAY (applied at once). */
      beforeEach(() => {
        id = addChild(db, 1, { groupId: bears })
        upload('Betreuungsvertrag', EARLIER)
        upload('Masernnachweis', EARLIER)
        plan(id, change(hort, CHANGE_DAY, {}, true))
      })

      it('shows the care contract of before the change as stale, and no other type', () => {
        expect(reviews()).toEqual({ contract: CHANGE_DAY })
        expect(stale('Betreuungsvertrag')).toBe(true)
        expect(stale('Masernnachweis')).toBe(false)
        expect(overviewRow().missingRequired).toBe(true)
        expect(listOpenReviews(db, 1, TODAY)).toEqual([{ id, name: 'Kind Muster', groupId: hort, sections: ['contract'] }])
      })

      it('clears the marker when a newer care contract is uploaded, not by another type', () => {
        upload('Masernnachweis', NOW)
        expect(reviews()).toEqual({ contract: CHANGE_DAY })
        expect(stale('Betreuungsvertrag')).toBe(true)

        upload('Betreuungsvertrag', NOW)

        expect(contractMark(id)).toBeNull()
        expect(reviews()).toEqual({})
        expect(stale('Betreuungsvertrag')).toBe(false)
        expect(listOpenReviews(db, 1, TODAY)).toEqual([])
      })

      it('counts an upload on the change day as new and one from the day before as old', () => {
        upload('Betreuungsvertrag', new Date('2026-09-30T10:00:00.000Z'))
        expect(contractMark(id)).toBe(CHANGE_DAY)
        upload('Betreuungsvertrag', new Date('2026-10-01T10:00:00.000Z'))
        expect(contractMark(id)).toBeNull()
      })

      it('clears the marker by confirming it, leaving the other sections alone', () => {
        const other = addChild(db, 1, { groupId: bears })
        plan(other, change(hort, CHANGE_DAY, { health: false }, true))

        confirmSection(db, admin, 1, other, 'contract', TODAY, NOW)

        expect(getChild(db, admin, other, TODAY).reviews).toEqual({ health: CHANGE_DAY })
        expect(reviews()).toEqual({ contract: CHANGE_DAY })
        confirmSection(db, admin, 1, id, 'contract', TODAY, NOW)
        expect(reviews()).toEqual({})
        expect(stale('Betreuungsvertrag')).toBe(false)
      })

      it('is independent of the documents marker: each is cleared by its own rule', () => {
        const other = addChild(db, 1, { groupId: bears })
        plan(other, change(hort, CHANGE_DAY, { documents: false }, true))
        expect(getChild(db, admin, other, TODAY).reviews).toEqual({ documents: CHANGE_DAY, contract: CHANGE_DAY })

        confirmSection(db, admin, 1, other, 'documents', TODAY, NOW)
        expect(getChild(db, admin, other, TODAY).reviews).toEqual({ contract: CHANGE_DAY })
      })

      it('follows the document type that is flagged as the care contract', () => {
        flagAsContract('Masernnachweis', true)
        expect(stale('Betreuungsvertrag')).toBe(false)
        expect(stale('Masernnachweis')).toBe(true)

        upload('Betreuungsvertrag', NOW)
        expect(reviews()).toEqual({ contract: CHANGE_DAY })
        upload('Masernnachweis', NOW)
        expect(reviews()).toEqual({})
      })

      it('stays until it is confirmed when no document type is flagged as the care contract', () => {
        flagAsContract('Betreuungsvertrag', false)
        expect(stale('Betreuungsvertrag')).toBe(false)
        expect(reviews()).toEqual({ contract: CHANGE_DAY })

        upload('Betreuungsvertrag', NOW)
        expect(reviews()).toEqual({ contract: CHANGE_DAY })
        confirmSection(db, admin, 1, id, 'contract', TODAY, NOW)
        expect(reviews()).toEqual({})
      })
    })
  })

  it('stores at most one entry per child and day, and one start entry', () => {
    const id = addChild(db, 1, { groupId: bears })
    const row = { childId: id, groupId: mice, fromDate: '2027-01-01', createdAt: NOW.toISOString() }
    db.insert(childGroupChanges).values(row).run()
    expect(() => db.insert(childGroupChanges).values({ ...row, groupId: owls }).run()).toThrow(/UNIQUE/)
    expect(() => db.insert(childGroupChanges).values({ ...row, fromDate: null }).run()).toThrow(/UNIQUE/)
    // Another child may change on the same day.
    const other = addChild(db, 1, { groupId: bears })
    db.insert(childGroupChanges).values({ ...row, childId: other }).run()
  })

  it('deletes the history with the child', () => {
    const id = addChild(db, 1, { groupId: bears })
    planGroupChange(db, admin, 1, id, change(mice, '2027-03-15'), TODAY, NOW)
    db.delete(children).where(eq(children.id, id)).run()
    expect(db.select().from(childGroupChanges).all()).toEqual([])
  })
})
