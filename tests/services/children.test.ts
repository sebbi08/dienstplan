import { beforeEach, describe, expect, it } from 'vitest'
import { CONSENT_KEYS } from '../../shared/types/api'
import type { ChildMasterInput, ChildContactInput } from '../../shared/types/api'
import type { Db } from '../../server/db/client'
import { createCareType } from '../../server/services/careTypes'
import { addContact } from '../../server/services/childContacts'
import { setSchoolCutoff } from '../../server/services/schoolChildren'
import { computedSchoolStart } from '../../shared/domain/schoolStart'
import {
  childSchoolCutoff, createChild, getChild, listBirthdays, listChildren, updateChildConsents, updateChildHealth, updateChildMaster,
} from '../../server/services/children'
import type { ChildActor } from '../../server/lib/childViewer'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-09'
const NOW = new Date('2026-10-09T08:30:00.000Z')

const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
  lastName: 'Meier', firstName: 'Lena', birthDate: '2022-03-15', address: '', groupId: null, careTypeId: null,
  entryDate: '2025-09-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
  schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null, ...overrides,
})

const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})

describe('child records', () => {
  let db: Db
  let admin: ChildActor
  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
  })

  const names = (items: { lastName: string; firstName: string }[]) => items.map(item => `${item.lastName} ${item.firstName}`)

  describe('lists', () => {
    it('lists active children by group order, children without a group last, then by name', () => {
      const mice = addGroup(db, 1, 'Mäuse')
      const bears = addGroup(db, 1, 'Bären')
      addChild(db, 1, { lastName: 'Zander', firstName: 'Zoe', groupId: bears })
      addChild(db, 1, { lastName: 'Adler', firstName: 'Ben', groupId: bears })
      addChild(db, 1, { lastName: 'Berg', firstName: 'Mia', groupId: mice })
      addChild(db, 1, { lastName: 'Albers', firstName: 'Tom', groupId: null })
      expect(names(listChildren(db, 1, 'active', TODAY, null))).toEqual([
        'Berg Mia', 'Adler Ben', 'Zander Zoe', 'Albers Tom',
      ])
    })

    it('keeps planned and archived children out of the active list and shows age, care type and entry', () => {
      const careType = createCareType(db, 1, { name: 'Ganztag', start: 420, end: 960, sortOrder: 0 })
      addChild(db, 1, { lastName: 'Aktiv', birthDate: '2022-03-15', careTypeId: careType.id })
      addChild(db, 1, { lastName: 'Zukunft', entryDate: '2026-11-01' })
      addChild(db, 1, { lastName: 'Ohne', entryDate: null })
      addChild(db, 1, { lastName: 'Weg', leftOn: '2026-10-08' })
      const [only, ...rest] = listChildren(db, 1, 'active', TODAY, null)
      expect(rest).toEqual([])
      expect(only).toMatchObject({
        lastName: 'Aktiv', age: { years: 4, months: 6 }, careTypeName: 'Ganztag', entryDate: '2025-09-01',
        plannedEntryDate: null, groupId: null, hasAllergies: false, contactBans: [],
      })
    })

    it('shows allergies and contact bans on the list item', () => {
      const id = addChild(db, 1, { allergies: 'Nüsse' })
      addContact(db, admin, 1, id, contact({ name: 'Karl', mayPickUp: false, contactBan: true, contactBanNote: 'gerichtlich' }), TODAY, NOW)
      addContact(db, admin, 1, id, contact({ name: 'Anna' }), TODAY, NOW)
      const [item] = listChildren(db, 1, 'active', TODAY, null)
      expect(item!.hasAllergies).toBe(true)
      expect(item!.contactBans).toEqual([{ name: 'Karl', note: 'gerichtlich' }])
    })

    it('does not list children of another facility', () => {
      const other = addFacility(db, 'Andere Kita')
      addChild(db, other, { lastName: 'Fremd' })
      addChild(db, 1, { lastName: 'Eigen' })
      expect(names(listChildren(db, 1, 'active', TODAY, null))).toEqual(['Eigen Kind'])
      expect(names(listChildren(db, other, 'active', TODAY, null))).toEqual(['Fremd Kind'])
    })
  })

  describe('record', () => {
    it('creates a child, stamps the master section with the actor and returns the record', () => {
      const group = addGroup(db, 1, 'Mäuse')
      const careType = createCareType(db, 1, { name: 'Halbtag', start: 420, end: 780, sortOrder: 0 })
      const id = createChild(db, admin, 1, master({ groupId: group, careTypeId: careType.id, lastName: '  Meier ' }), NOW)
      const record = getChild(db, admin, id, TODAY)
      expect(record).toMatchObject({
        id, status: 'active', leftOn: null, purgeOn: null, canEdit: true, documents: [],
        master: { lastName: 'Meier', firstName: 'Lena', groupId: group, careTypeId: careType.id },
        health: { measlesProof: null, allergies: '', mayApplyPlaster: null },
        contacts: [],
      })
      expect(record.stamps.master).toEqual({ updatedAt: NOW.toISOString(), updatedBy: 'leitung' })
      expect(record.stamps.health).toEqual({ updatedAt: null, updatedBy: null })
      expect(Object.keys(record.consents)).toEqual([...CONSENT_KEYS])
      expect(Object.values(record.consents).every(value => value === null)).toBe(true)
    })

    it('rejects blank names, a birth date in the future, bad dates and foreign groups or care types', () => {
      const other = addFacility(db, 'Andere Kita')
      const foreignGroup = addGroup(db, other, 'Fremd')
      const foreignCare = createCareType(db, other, { name: 'Fremd', start: 420, end: 780, sortOrder: 0 })
      expect(errorCode(() => createChild(db, admin, 1, master({ lastName: '  ' }), NOW))).toBe('name_required')
      expect(errorCode(() => createChild(db, admin, 1, master({ firstName: '' }), NOW))).toBe('name_required')
      expect(errorCode(() => createChild(db, admin, 1, master({ birthDate: '2026-10-10' }), NOW))).toBe('birth_date_in_future')
      expect(errorCode(() => createChild(db, admin, 1, master({ birthDate: '2026-10-09' }), NOW))).toBeNull()
      expect(errorCode(() => createChild(db, admin, 1, master({ entryDate: '2026-02-30' }), NOW))).toBe('invalid_date')
      expect(errorCode(() => createChild(db, admin, 1, master({ schoolStartDate: 'morgen' }), NOW))).toBe('invalid_date')
      expect(errorCode(() => createChild(db, admin, 1, master({ groupId: foreignGroup }), NOW))).toBe('group_not_found')
      expect(errorCode(() => createChild(db, admin, 1, master({ careTypeId: foreignCare.id }), NOW))).toBe('care_type_not_found')
    })

    it('updates master data, health and consents and stamps each section', () => {
      const id = createChild(db, admin, 1, master(), NOW)
      const editor = asChildViewer(addUser(db, 'frau-k', 'observer', addEmployee(db, 'Frau K')))
      const later = new Date('2026-10-10T09:00:00.000Z')
      updateChildMaster(db, editor, 1, id, master({ firstName: 'Lea', address: 'Weg 1' }), TODAY, later)
      updateChildHealth(db, editor, 1, id, {
        measlesProof: true, measlesProofDate: '2025-05-01', infectionBriefingDate: '2025-06-01', allergies: 'Nüsse',
        mayTakeTemperature: true, mayApplySunscreen: false, mayApplyPlaster: null,
      }, TODAY, later)
      const consents = Object.fromEntries(CONSENT_KEYS.map((key, index) => [key, index % 3 === 0 ? true : index % 3 === 1 ? false : null]))
      updateChildConsents(db, editor, 1, id, consents as never, TODAY, later)
      const record = getChild(db, admin, id, TODAY)
      expect(record.master).toMatchObject({ firstName: 'Lea', address: 'Weg 1' })
      expect(record.health).toEqual({
        measlesProof: true, measlesProofDate: '2025-05-01', infectionBriefingDate: '2025-06-01', allergies: 'Nüsse',
        mayTakeTemperature: true, mayApplySunscreen: false, mayApplyPlaster: null,
      })
      expect(record.consents).toEqual(consents)
      for (const section of ['master', 'health', 'consents'] as const) {
        expect(record.stamps[section]).toEqual({ updatedAt: later.toISOString(), updatedBy: 'frau-k' })
      }
      expect(record.stamps.contacts).toEqual({ updatedAt: null, updatedBy: null })
    })

    it('validates updates like creation', () => {
      const id = createChild(db, admin, 1, master(), NOW)
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ lastName: ' ' }), TODAY, NOW))).toBe('name_required')
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ birthDate: '2026-10-10' }), TODAY, NOW)))
        .toBe('birth_date_in_future')
      expect(errorCode(() => updateChildHealth(db, admin, 1, id, {
        measlesProof: null, measlesProofDate: '31.12.2025', infectionBriefingDate: null, allergies: '',
        mayTakeTemperature: null, mayApplySunscreen: null, mayApplyPlaster: null,
      }, TODAY, NOW))).toBe('invalid_date')
    })

    it('answers child_not_found for children of another facility and for unknown ids', () => {
      const other = addFacility(db, 'Andere Kita')
      const foreign = addChild(db, other)
      expect(errorCode(() => getChild(db, admin, foreign, TODAY))).toBe('child_not_found')
      expect(errorCode(() => getChild(db, admin, 9999, TODAY))).toBe('child_not_found')
      expect(errorCode(() => updateChildMaster(db, admin, 1, foreign, master(), TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => updateChildHealth(db, admin, 1, foreign, {
        measlesProof: null, measlesProofDate: null, infectionBriefingDate: null, allergies: '',
        mayTakeTemperature: null, mayApplySunscreen: null, mayApplyPlaster: null,
      }, TODAY, NOW))).toBe('child_not_found')
    })

    it('hides archived children from non-managers and shows managers a read-only record', () => {
      const id = addChild(db, 1, { leftOn: '2026-09-30' })
      const observer = asChildViewer(addUser(db, 'mitarbeiter', 'observer', addEmployee(db, 'Mit Arbeiter')))
      expect(errorCode(() => getChild(db, observer, id, TODAY))).toBe('child_not_found')
      const record = getChild(db, admin, id, TODAY)
      expect(record).toMatchObject({ status: 'archived', leftOn: '2026-09-30', canEdit: false })
    })

    it('rejects every update of an archived child: child_archived for managers, child_not_found for a Mitarbeiter', () => {
      const id = addChild(db, 1, { leftOn: '2026-09-30' })
      const editor = asChildViewer({ ...addUser(db, 'editor', 'observer', addEmployee(db, 'Editor')), canEditChildren: true })
      const health = {
        measlesProof: null, measlesProofDate: null, infectionBriefingDate: null, allergies: '',
        mayTakeTemperature: null, mayApplySunscreen: null, mayApplyPlaster: null,
      }
      const consents = Object.fromEntries(CONSENT_KEYS.map(key => [key, null])) as never
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master(), TODAY, NOW))).toBe('child_archived')
      expect(errorCode(() => updateChildHealth(db, admin, 1, id, health, TODAY, NOW))).toBe('child_archived')
      expect(errorCode(() => updateChildConsents(db, admin, 1, id, consents, TODAY, NOW))).toBe('child_archived')
      expect(errorCode(() => updateChildMaster(db, editor, 1, id, master(), TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => updateChildHealth(db, editor, 1, id, health, TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => updateChildConsents(db, editor, 1, id, consents, TODAY, NOW))).toBe('child_not_found')
    })

    it('lets only editors edit: canEdit follows the permission', () => {
      const id = addChild(db, 1)
      const plain = asChildViewer(addUser(db, 'plain', 'observer', addEmployee(db, 'Plain')))
      const allowed = asChildViewer(addUser(db, 'allowed', 'observer', addEmployee(db, 'Allowed')))
      allowed.canEditChildren = true
      expect(getChild(db, plain, id, TODAY).canEdit).toBe(false)
      expect(getChild(db, allowed, id, TODAY).canEdit).toBe(true)
      expect(getChild(db, admin, id, TODAY).canEdit).toBe(true)
    })

    it('returns the contacts of the record in their order and stores the leaving day', () => {
      const id = addChild(db, 1, { leftOn: '2026-12-31' })
      addContact(db, admin, 1, id, contact({ name: 'Erste' }), TODAY, NOW)
      addContact(db, admin, 1, id, contact({ name: 'Zweite' }), TODAY, NOW)
      const record = getChild(db, admin, id, TODAY)
      expect(record.status).toBe('active')
      expect(record.leftOn).toBe('2026-12-31')
      expect(record.contacts.map(item => item.name)).toEqual(['Erste', 'Zweite'])
    })
  })

  describe('birthdays', () => {
    it('lists the next birthday of active children sorted by date, with the age they turn', () => {
      addChild(db, 1, { lastName: 'Spaet', firstName: 'A', birthDate: '2021-12-24' })
      addChild(db, 1, { lastName: 'Heute', firstName: 'B', birthDate: '2022-10-09' })
      addChild(db, 1, { lastName: 'Schalt', firstName: 'C', birthDate: '2020-02-29' })
      addChild(db, 1, { lastName: 'Vorbei', firstName: 'D', birthDate: '2022-01-05' })
      const groupId = addGroup(db, 1, 'Mäuse')
      addChild(db, 1, { lastName: 'Gruppe', firstName: 'E', birthDate: '2023-10-12', groupId })
      addChild(db, 1, { lastName: 'Weg', firstName: 'F', birthDate: '2022-10-10', leftOn: '2026-09-01' })
      addChild(db, 1, { lastName: 'Neu', firstName: 'G', birthDate: '2022-10-11', entryDate: '2026-12-01' })
      addChild(db, addFacility(db, 'Andere Kita'), { lastName: 'Fremd', birthDate: '2022-10-10' })
      const result = listBirthdays(db, 1, TODAY, null)
      expect(result.map(item => [item.name, item.date, item.turns])).toEqual([
        ['B Heute', '2026-10-09', 4],
        ['E Gruppe', '2026-10-12', 3],
        ['A Spaet', '2026-12-24', 5],
        ['D Vorbei', '2027-01-05', 5],
        ['C Schalt', '2027-02-28', 7],
      ])
      expect(result[1]).toMatchObject({ groupId, birthDate: '2023-10-12' })
      expect(result[0]!.childId).toBeGreaterThan(0)
    })
  })

  describe('school start', () => {
    // Born 1 July 2021: with the default cutoff (30 June, 6 years) school starts on 1 September 2028.
    const BIRTH = '2021-07-01'
    let editor: ChildActor
    let provider: ChildActor
    beforeEach(() => {
      editor = asChildViewer({ ...addUser(db, 'editor', 'observer', addEmployee(db, 'Editor')), canEditChildren: true })
      provider = asChildViewer(addUser(db, 'traeger', 'provider'))
    })
    const stored = (id: number) => getChild(db, admin, id, TODAY).master.schoolStartDate

    it('refuses a school start from a Mitarbeiter when creating and stores nothing', () => {
      expect(errorCode(() => createChild(db, editor, 1, master({ birthDate: BIRTH, schoolStartDate: '2029-09-01' }), NOW)))
        .toBe('school_start_managers_only')
      expect(listChildren(db, 1, 'active', TODAY, null)).toEqual([])
    })

    it('keeps the school start of a child a Mitarbeiter creates automatic: nothing stored, the computed one counts', () => {
      const id = createChild(db, editor, 1, master({ birthDate: BIRTH }), NOW)
      const record = getChild(db, admin, id, TODAY)
      expect(record.master.schoolStartDate).toBeNull()
      expect(record.computedSchoolStart).toBe('2028-09-01')
      // It keeps following the cutoff.
      setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
      expect(getChild(db, admin, id, TODAY).computedSchoolStart).toBe('2027-09-01')
    })

    it('refuses a Mitarbeiter setting, changing or clearing the school start in the master data', () => {
      const automatic = createChild(db, admin, 1, master({ birthDate: BIRTH }), NOW)
      expect(errorCode(() => updateChildMaster(db, editor, 1, automatic, master({ birthDate: BIRTH, schoolStartDate: '2029-09-01' }), TODAY, NOW)))
        .toBe('school_start_managers_only')
      expect(stored(automatic)).toBeNull()
      const manual = createChild(db, admin, 1, master({ birthDate: BIRTH, schoolStartDate: '2029-09-01' }), NOW)
      expect(errorCode(() => updateChildMaster(db, editor, 1, manual, master({ birthDate: BIRTH, schoolStartDate: '2030-09-01' }), TODAY, NOW)))
        .toBe('school_start_managers_only')
      expect(errorCode(() => updateChildMaster(db, editor, 1, manual, master({ birthDate: BIRTH, schoolStartDate: null }), TODAY, NOW)))
        .toBe('school_start_managers_only')
      expect(stored(manual)).toBe('2029-09-01')
    })

    it('keeps a stored school start when a Mitarbeiter saves other master data', () => {
      const id = createChild(db, admin, 1, master({ birthDate: BIRTH, schoolStartDate: '2029-09-01' }), NOW)
      updateChildMaster(db, editor, 1, id, { ...getChild(db, editor, id, TODAY).master, note: 'neu' }, TODAY, NOW)
      expect(getChild(db, admin, id, TODAY).master).toMatchObject({ note: 'neu', schoolStartDate: '2029-09-01' })
    })

    it('lets Leitung and Träger set, change and clear the school start', () => {
      const id = createChild(db, admin, 1, master({ birthDate: BIRTH, schoolStartDate: '2029-09-01' }), NOW)
      expect(stored(id)).toBe('2029-09-01')
      updateChildMaster(db, provider, 1, id, master({ birthDate: BIRTH, schoolStartDate: '2030-09-01' }), TODAY, NOW)
      expect(stored(id)).toBe('2030-09-01')
      updateChildMaster(db, admin, 1, id, master({ birthDate: BIRTH, schoolStartDate: null }), TODAY, NOW)
      expect(stored(id)).toBeNull()
      expect(createChild(db, provider, 1, master({ birthDate: BIRTH, schoolStartDate: '2029-09-01' }), NOW)).toBeGreaterThan(0)
    })

    it('gives the child pages the cutoff the record computes the school start with', () => {
      setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
      const id = createChild(db, editor, 1, master({ birthDate: BIRTH }), NOW)
      const preview = computedSchoolStart(BIRTH, childSchoolCutoff(db, editor))
      expect(preview).toBe(getChild(db, editor, id, TODAY).computedSchoolStart)
      expect(preview).toBe('2027-09-01')
    })
  })
})
