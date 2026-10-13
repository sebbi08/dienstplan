import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { childCreateSchema, childMasterSchema } from '../../server/schemas'
import type { Db } from '../../server/db/client'
import { children } from '../../server/db/schema'
import { createCareType } from '../../server/services/careTypes'
import { addContact } from '../../server/services/childContacts'
import { documentOverview } from '../../server/services/childDocuments'
import {
  createChild, deleteChild, getChild, leaveChild, listBirthdays, listChildren, listPlanned, updateChildMaster,
} from '../../server/services/children'
import type { FacilityUser } from '../../server/utils/auth'
import type { ChildContactInput, ChildMasterInput } from '../../shared/types/api'
import { addChild, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')

const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
  lastName: 'Meier', firstName: 'Lena', birthDate: '2024-03-15', address: '', groupId: null, careTypeId: null,
  entryDate: null, plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
  schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'waitlist', waitlistedOn: null, ...overrides,
})

const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})

describe('admission status and planned lists', () => {
  let db: Db
  let admin: FacilityUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin') as FacilityUser
  })

  const names = (items: { lastName: string }[]) => items.map(item => item.lastName)

  describe('validation', () => {
    it('rejects a waitlist child with an entry date', () => {
      expect(errorCode(() => createChild(db, admin, 1, master({ entryDate: '2027-01-01' }), NOW))).toBe('waitlist_has_entry')
      const id = createChild(db, admin, 1, master(), NOW)
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ entryDate: '2027-01-01' }), TODAY, NOW)))
        .toBe('waitlist_has_entry')
    })

    it('allows a planned entry date on a waitlist child', () => {
      const id = createChild(db, admin, 1, master({ plannedEntryDate: '2027-02-01' }), NOW)
      expect(getChild(db, admin, id, TODAY).master).toMatchObject({ admissionStatus: 'waitlist', plannedEntryDate: '2027-02-01' })
    })

    it('stores the waitlist date only for waitlist children, today by default', () => {
      const a = createChild(db, admin, 1, master(), NOW)
      expect(getChild(db, admin, a, TODAY).master.waitlistedOn).toBe(TODAY)
      const b = createChild(db, admin, 1, master({ waitlistedOn: '2026-05-04' }), NOW)
      expect(getChild(db, admin, b, TODAY).master.waitlistedOn).toBe('2026-05-04')
      const c = createChild(db, admin, 1, master({ admissionStatus: 'contract', waitlistedOn: '2026-05-04' }), NOW)
      expect(getChild(db, admin, c, TODAY).master).toMatchObject({ admissionStatus: 'contract', waitlistedOn: null })
      expect(errorCode(() => createChild(db, admin, 1, master({ waitlistedOn: '2026-02-30' }), NOW))).toBe('invalid_date')
    })

    it('keeps the record when the waitlist child gets a contract and the child moves to the contracted list', () => {
      const id = createChild(db, admin, 1, master({ lastName: 'Wechsel', waitlistedOn: '2026-05-04' }), NOW)
      expect(names(listPlanned(db, 1, TODAY).waitlist)).toEqual(['Wechsel'])
      updateChildMaster(db, admin, 1, id, master({
        lastName: 'Wechsel', admissionStatus: 'contract', entryDate: '2027-01-01', waitlistedOn: '2026-05-04',
      }), TODAY, NOW)
      const planned = listPlanned(db, 1, TODAY)
      expect(planned.waitlist).toEqual([])
      expect(planned.contracted).toMatchObject([{ id, lastName: 'Wechsel', plannedStart: '2027-01-01', waitlistedOn: null }])
      expect(getChild(db, admin, id, TODAY)).toMatchObject({ status: 'planned' })
    })
  })

  describe('switching to the waitlist', () => {
    it('clears a future leaving day, so the purge job never keys on a waitlist child', () => {
      const id = addChild(db, 1, { entryDate: '2027-01-01', leftOn: '2027-06-30' })
      updateChildMaster(db, admin, 1, id, master({ plannedEntryDate: '2027-01-01' }), TODAY, NOW)
      expect(db.select({ leftOn: children.leftOn }).from(children).where(eq(children.id, id)).get()!.leftOn).toBeNull()
      expect(getChild(db, admin, id, TODAY)).toMatchObject({ status: 'planned', leftOn: null })
    })

    it('refuses a child that has already started', () => {
      const active = addChild(db, 1, { entryDate: '2025-09-01' })
      const sinceToday = addChild(db, 1, { entryDate: TODAY })
      const leaving = addChild(db, 1, { entryDate: '2025-09-01', leftOn: '2026-12-31' })
      for (const id of [active, sinceToday, leaving]) {
        const before = db.select().from(children).where(eq(children.id, id)).get()
        expect(errorCode(() => updateChildMaster(db, admin, 1, id, master(), TODAY, NOW))).toBe('waitlist_after_start')
        // The reason is the same when the entry date is still filled in.
        expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ entryDate: '2025-09-01' }), TODAY, NOW)))
          .toBe('waitlist_after_start')
        expect(db.select().from(children).where(eq(children.id, id)).get()).toEqual(before)
      }
    })

    it('allows a contract child that has not started: entry tomorrow, or only a planned entry', () => {
      const tomorrow = addChild(db, 1, { entryDate: '2026-10-14' })
      const plannedOnly = addChild(db, 1, { entryDate: null, plannedEntryDate: '2026-09-01' })
      for (const id of [tomorrow, plannedOnly]) {
        updateChildMaster(db, admin, 1, id, master(), TODAY, NOW)
        expect(getChild(db, admin, id, TODAY)).toMatchObject({ status: 'planned', master: { admissionStatus: 'waitlist', entryDate: null } })
      }
    })

    it('lets a waitlist child be saved again', () => {
      const id = addChild(db, 1, { admissionStatus: 'waitlist', entryDate: null })
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ note: 'ruft zurück' }), TODAY, NOW))).toBeNull()
    })
  })

  describe('request schemas', () => {
    const body = (({ admissionStatus: _status, ...rest }) => rest)(master())

    it('requires the admission status on update, so an old client cannot turn a waitlist child into a contract child', () => {
      expect(childMasterSchema.safeParse({ ...body, baseGroupId: null }).success).toBe(false)
      expect(childMasterSchema.safeParse({ ...master(), baseGroupId: null }).success).toBe(true)
    })

    it('requires the group the form was loaded with on update, so an old client cannot undo an applied group change', () => {
      expect(childMasterSchema.safeParse(master()).success).toBe(false)
      expect(childMasterSchema.parse({ ...master(), baseGroupId: 3 }).baseGroupId).toBe(3)
    })

    it('lets a new child omit it (a contract child)', () => {
      expect(childCreateSchema.parse(body).admissionStatus).toBe('contract')
    })
  })

  describe('waitlist children are never active', () => {
    it('stays out of the active list, the birthdays and the document overview even with a past planned date', () => {
      const id = addChild(db, 1, {
        lastName: 'Wartend', admissionStatus: 'waitlist', entryDate: '2025-09-01', plannedEntryDate: '2025-09-01', waitlistedOn: '2025-01-01',
      })
      addChild(db, 1, { lastName: 'Aktiv' })
      expect(names(listChildren(db, 1, 'active', TODAY))).toEqual(['Aktiv'])
      expect(listBirthdays(db, 1, TODAY).map(item => item.childId)).not.toContain(id)
      expect(documentOverview(db, admin, 1, TODAY).rows.map(row => row.childId)).not.toContain(id)
      expect(getChild(db, admin, id, TODAY).status).toBe('planned')
    })
  })

  describe('listPlanned', () => {
    it('sorts the waitlist by waitlist date (undated last) then name', () => {
      addChild(db, 1, { lastName: 'Zeitlos', admissionStatus: 'waitlist', entryDate: null, waitlistedOn: null })
      addChild(db, 1, { lastName: 'Spaet', admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-09-01' })
      addChild(db, 1, { lastName: 'Zwilling', admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-03-01' })
      addChild(db, 1, { lastName: 'Admin', admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-03-01' })
      addChild(db, 1, { lastName: 'Ohne', admissionStatus: 'waitlist', entryDate: null, waitlistedOn: null })
      expect(names(listPlanned(db, 1, TODAY).waitlist)).toEqual(['Admin', 'Zwilling', 'Spaet', 'Ohne', 'Zeitlos'])
    })

    it('sorts the contracted by planned start (undated last) then name; entry date wins over planned entry date', () => {
      addChild(db, 1, { lastName: 'Spaet', entryDate: '2027-01-01' })
      addChild(db, 1, { lastName: 'Geplant', entryDate: null, plannedEntryDate: '2026-12-01' })
      addChild(db, 1, { lastName: 'Zeitlos', entryDate: null })
      addChild(db, 1, { lastName: 'Admin', entryDate: null })
      addChild(db, 1, { lastName: 'Bald', entryDate: '2026-10-20', plannedEntryDate: '2030-01-01' })
      addChild(db, 1, { lastName: 'Aktiv' })
      const { contracted, waitlist } = listPlanned(db, 1, TODAY)
      expect(names(contracted)).toEqual(['Bald', 'Geplant', 'Spaet', 'Admin', 'Zeitlos'])
      expect(contracted.map(item => item.plannedStart)).toEqual(['2026-10-20', '2026-12-01', '2027-01-01', null, null])
      expect(waitlist).toEqual([])
    })

    it('fills group, care type, note and the first contact\'s phone (mobile, then home, then work)', () => {
      const group = addGroup(db, 1, 'Mäuse')
      const careType = createCareType(db, 1, { name: 'Ganztag', start: 420, end: 960, sortOrder: 0 })
      const id = addChild(db, 1, { lastName: 'Kind', entryDate: null, groupId: group, careTypeId: careType.id })
      db.update(children).set({ note: 'Geschwisterkind' }).where(eq(children.id, id)).run()
      const phoneOf = () => listPlanned(db, 1, TODAY).contracted.find(item => item.id === id)!.phone
      expect(phoneOf()).toBe('')
      addContact(db, admin, 1, id, contact({ name: 'Erste', phoneWork: '03', phoneHome: '02' }), TODAY, NOW)
      addContact(db, admin, 1, id, contact({ name: 'Zweite', phoneMobile: '0170 9' }), TODAY, NOW)
      expect(phoneOf()).toBe('02')
      expect(listPlanned(db, 1, TODAY).contracted[0]).toMatchObject({
        id, groupId: group, careTypeName: 'Ganztag', note: 'Geschwisterkind', waitlistedOn: null,
      })
    })

    it('prefers the mobile number and falls back to the work number', () => {
      const a = addChild(db, 1, { lastName: 'A', entryDate: null })
      const b = addChild(db, 1, { lastName: 'B', entryDate: null })
      addContact(db, admin, 1, a, contact({ phoneMobile: '0170 1', phoneHome: '02', phoneWork: '03' }), TODAY, NOW)
      addContact(db, admin, 1, b, contact({ phoneWork: '03' }), TODAY, NOW)
      const phones = Object.fromEntries(listPlanned(db, 1, TODAY).contracted.map(item => [item.lastName, item.phone]))
      expect(phones).toEqual({ A: '0170 1', B: '03' })
    })

    it('leaves out the other facility\'s children', () => {
      const other = addFacility(db, 'Krippe')
      addChild(db, other, { lastName: 'Fremd', entryDate: null })
      addChild(db, other, { lastName: 'FremdWartend', admissionStatus: 'waitlist', entryDate: null })
      addChild(db, 1, { lastName: 'Eigen', entryDate: null })
      expect(names(listPlanned(db, 1, TODAY).contracted)).toEqual(['Eigen'])
      expect(listPlanned(db, 1, TODAY).waitlist).toEqual([])
    })
  })

  describe('leaving and deleting', () => {
    it('does not let a waitlist child leave', () => {
      const id = addChild(db, 1, { admissionStatus: 'waitlist', entryDate: null })
      expect(errorCode(() => leaveChild(db, 1, id, TODAY, TODAY))).toBe('waitlist_cannot_leave')
    })

    it('lets a manager delete a waitlist child', () => {
      const id = addChild(db, 1, { admissionStatus: 'waitlist', entryDate: null })
      deleteChild(db, 1, id)
      expect(listPlanned(db, 1, TODAY).waitlist).toEqual([])
    })
  })
})
