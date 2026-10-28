import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childContacts, children } from '../../server/db/schema'
import type { ChildActor, ChildViewer } from '../../server/lib/childViewer'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { addContact } from '../../server/services/childContacts'
import { childrenOverview, listChildren, updateChildConsents, updateChildHealth } from '../../server/services/children'
import { addMeeting } from '../../server/services/parentMeetings'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { CONSENT_KEYS, type ChildConsents, type ChildContactInput, type ParentMeetingInput, type SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, allowChildEditing, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-19'
const NOW = new Date('2026-10-19T06:00:00Z')

const contact = (overrides: Partial<ChildContactInput> = {}): ChildContactInput => ({
  name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
  mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '', ...overrides,
})
const meeting = (overrides: Partial<ParentMeetingInput> = {}): ParentMeetingInput => ({
  date: '2026-09-01', start: 600, end: 660, kind: 'development', participants: 'Mutter', ...overrides,
})
const openConsents = (): ChildConsents => Object.fromEntries(CONSENT_KEYS.map(key => [key, null])) as ChildConsents

describe('children overview', () => {
  let db: Db
  let tablet: SessionUser
  let observer: SessionUser
  let admin: ChildActor
  let a: number
  let b: number
  let c: number
  let kidA: number
  let kidA2: number
  let kidB: number
  let kidC: number
  let kidNone: number
  let token: string

  /** The person at the tablet (group A, read access to B). */
  const staff = (): ChildViewer => resolveChildViewer(db, tablet, token, NOW)

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
    observer = addUser(db, 'anna', 'observer', anna)
    allowChildEditing(db, observer.id)
    setReadAccess(db, 1, a, [b])
    kidNone = addChild(db, 1, { lastName: 'Dachs', groupId: null })
    kidA2 = addChild(db, 1, { lastName: 'Zebra', groupId: a })
    kidC = addChild(db, 1, { lastName: 'Chamäleon', groupId: c })
    kidB = addChild(db, 1, { lastName: 'Biber', groupId: b })
    kidA = addChild(db, 1, { lastName: 'Amsel', groupId: a })
    token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, anna, '123456', NOW).token
  })

  it('lists the active children in the order of the child list, with their groups (no group last)', () => {
    addChild(db, 1, { lastName: 'Gegangen', groupId: a, leftOn: '2026-09-30' })
    addChild(db, 1, { lastName: 'Geplant', groupId: a, entryDate: '2027-01-01' })
    addChild(db, 1, { lastName: 'Vorgemerkt', groupId: a, entryDate: null, admissionStatus: 'waitlist', waitlistedOn: '2026-05-01' })
    const overview = childrenOverview(db, admin, TODAY)
    expect(overview.children.map(row => row.id)).toEqual([kidA, kidA2, kidB, kidC, kidNone])
    expect(overview.children.map(row => row.id))
      .toEqual(listChildren(db, 1, 'active', TODAY, null).map(item => item.id))
    expect(overview.groups).toEqual([
      { id: a, name: 'Bären' }, { id: b, name: 'Mäuse' }, { id: c, name: 'Füchse' }, { id: null, name: '' },
    ])
  })

  it('gives the staff member the own group, the readable group and children without group, nothing of others', () => {
    for (const id of [kidA, kidB, kidC, kidNone]) {
      addContact(db, admin, 1, id, contact({ name: `Kontakt ${id}`, phoneHome: `0911 ${id}` }), TODAY, NOW)
      addContact(db, admin, 1, id, contact({
        name: `Verbot ${id}`, mayPickUp: false, contactBan: true, contactBanNote: `Hinweis ${id}`,
      }), TODAY, NOW)
    }
    const overview = childrenOverview(db, staff(), TODAY)
    expect(overview.children.map(row => row.id)).toEqual([kidA, kidA2, kidB, kidNone])
    expect(overview.groups).toEqual([{ id: a, name: 'Bären' }, { id: b, name: 'Mäuse' }, { id: null, name: '' }])
    // Neither the phone numbers nor the contact bans of group C's child reach the client.
    const text = JSON.stringify(overview)
    expect(text).not.toContain(`Kontakt ${kidC}`)
    expect(text).not.toContain(`0911 ${kidC}`)
    expect(text).not.toContain(`Verbot ${kidC}`)
    expect(text).not.toContain(`Hinweis ${kidC}`)
    expect(text).not.toContain('Chamäleon')
    expect(overview.children.find(row => row.id === kidB)!.contacts.map(item => item.name))
      .toEqual([`Kontakt ${kidB}`, `Verbot ${kidB}`])
  })

  it('shows every child to the Leitung', () => {
    expect(childrenOverview(db, admin, TODAY).children.map(row => row.id)).toEqual([kidA, kidA2, kidB, kidC, kidNone])
  })

  it('refuses a staff member off the tablet before any child data is read', () => {
    expect(errorCode(() => resolveChildViewer(db, observer, undefined, NOW))).toBe('children_tablet_only')
    expect(errorCode(() => resolveChildViewer(db, observer, token, NOW))).toBe('children_tablet_only')
  })

  it('copies the contacts in the record\'s order with roles, phones and flags', () => {
    addContact(db, admin, 1, kidA, contact({
      name: 'Otto Muster', relation: 'Opa', phoneHome: '0911 2', phoneMobile: '', phoneWork: '0911 3', isGuardian: false,
      mayPickUp: true, emergencyRank: 2,
    }), TODAY, NOW)
    addContact(db, admin, 1, kidA, contact({
      name: 'Erika Muster', relation: '', phoneHome: '0911 1', phoneMobile: '0170 2', phoneWork: '0911 4', isGuardian: true,
      mayPickUp: false, emergencyRank: 1,
    }), TODAY, NOW)
    // The form refuses "may pick up" together with a contact ban, but a stored one (older data) keeps both flags, so
    // the client can leave it out of the pick-up list.
    db.insert(childContacts).values({
      childId: kidA, sortOrder: 99, name: 'Peter Fremd', relation: 'Vater', phoneMobile: '0170 1', mayPickUp: true,
      contactBan: true, contactBanNote: 'Gerichtsbeschluss', note: 'intern',
    }).run()
    const row = childrenOverview(db, admin, TODAY).children.find(item => item.id === kidA)!
    expect(row.contacts).toEqual([
      {
        name: 'Otto Muster', relation: 'Opa', phoneHome: '0911 2', phoneMobile: '', phoneWork: '0911 3', isGuardian: false,
        mayPickUp: true, contactBan: false, contactBanNote: '', emergencyRank: 2,
      },
      {
        name: 'Erika Muster', relation: '', phoneHome: '0911 1', phoneMobile: '0170 2', phoneWork: '0911 4', isGuardian: true,
        mayPickUp: false, contactBan: false, contactBanNote: '', emergencyRank: 1,
      },
      {
        name: 'Peter Fremd', relation: 'Vater', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: false,
        mayPickUp: true, contactBan: true, contactBanNote: 'Gerichtsbeschluss', emergencyRank: null,
      },
    ])
    // The internal note of a contact is not part of the overview.
    expect(JSON.stringify(row)).not.toContain('intern')
    const pickUp = row.contacts.filter(item => item.mayPickUp && !item.contactBan).map(item => item.name)
    expect(pickUp).toEqual(['Otto Muster'])
  })

  it('copies the consents, the health fields and the address', () => {
    const consents = { ...openConsents(), artworkDisplay: true, whatsappPhotos: false, signalPhotos: true, insectRepellent: false }
    updateChildConsents(db, admin, 1, kidB, consents, TODAY, NOW)
    updateChildHealth(db, admin, 1, kidB, {
      measlesProof: true, measlesProofDate: '2025-08-01', infectionBriefingDate: '2025-09-02', allergies: 'Nüsse, Laktose',
      mayTakeTemperature: true, mayApplySunscreen: false, mayApplyPlaster: null,
    }, TODAY, NOW)
    db.update(children).set({ address: 'Hauptstr. 1, 90402 Nürnberg' }).where(eq(children.id, kidB)).run()
    const row = childrenOverview(db, admin, TODAY).children.find(item => item.id === kidB)!
    expect(row).toEqual({
      id: kidB, lastName: 'Biber', firstName: 'Kind', groupId: b, address: 'Hauptstr. 1, 90402 Nürnberg', consents,
      measlesProof: true, measlesProofDate: '2025-08-01', infectionBriefingDate: '2025-09-02', allergies: 'Nüsse, Laktose',
      mayTakeTemperature: true, mayApplySunscreen: false, mayApplyPlaster: null, contacts: [], meetings: [],
    })
  })

  it('gives a child without contacts and health data empty values and open consents', () => {
    const row = childrenOverview(db, admin, TODAY).children.find(item => item.id === kidNone)!
    expect(row).toEqual({
      id: kidNone, lastName: 'Dachs', firstName: 'Kind', groupId: null, address: '', consents: openConsents(),
      measlesProof: null, measlesProofDate: null, infectionBriefingDate: null, allergies: '',
      mayTakeTemperature: null, mayApplySunscreen: null, mayApplyPlaster: null, contacts: [], meetings: [],
    })
  })

  describe('parent meetings', () => {
    it('lists each child\'s meetings newest first with date, start, kind and planned, never the note', () => {
      addMeeting(db, admin, kidA, meeting({ date: '2026-09-01', start: 600, kind: 'settling_in', note: 'Geheim alt' }), NOW)
      addMeeting(db, admin, kidA, meeting({ date: '2026-11-03', start: 900, end: null, note: 'Geheim neu' }), NOW)
      addMeeting(db, admin, kidA, meeting({ date: TODAY, start: 840, end: 900, kind: 'other', note: 'Geheim heute' }), NOW)
      addMeeting(db, admin, kidB, meeting({ date: '2026-10-01', kind: 'final' }), NOW)
      // 13:59 in Berlin (summer time): the meeting today at 14:00 still lies ahead.
      const before = new Date('2026-10-19T11:59:00Z')
      for (const viewer of [admin, staff()]) {
        const overview = childrenOverview(db, viewer, TODAY, before)
        expect(overview.children.find(row => row.id === kidA)!.meetings).toEqual([
          { date: '2026-11-03', start: 900, kind: 'development', planned: true },
          { date: TODAY, start: 840, kind: 'other', planned: true },
          { date: '2026-09-01', start: 600, kind: 'settling_in', planned: false },
        ])
        expect(overview.children.find(row => row.id === kidB)!.meetings)
          .toEqual([{ date: '2026-10-01', start: 600, kind: 'final', planned: false }])
        expect(overview.children.find(row => row.id === kidA2)!.meetings).toEqual([])
        // The confidential note reaches nobody through the overview, the staff member at the tablet least of all.
        const text = JSON.stringify(overview)
        expect(text).not.toContain('Geheim')
        expect(text).not.toContain('"note"')
      }
      // 14:01 in Berlin: it has begun.
      expect(childrenOverview(db, admin, TODAY, new Date('2026-10-19T12:01:00Z')).children
        .find(row => row.id === kidA)!.meetings.map(item => item.planned)).toEqual([true, false, false])
    })

    it('gives the staff member no meetings of a hidden group\'s child', () => {
      addMeeting(db, admin, kidC, meeting({ date: '2026-08-14' }), NOW)
      const overview = childrenOverview(db, staff(), TODAY, NOW)
      expect(overview.children.map(row => row.id)).not.toContain(kidC)
      expect(JSON.stringify(overview)).not.toContain('2026-08-14')
      expect(childrenOverview(db, admin, TODAY, NOW).children.find(row => row.id === kidC)!.meetings).toHaveLength(1)
    })
  })

  it('is empty for a facility without active children', () => {
    const krippe = addFacility(db, 'Krippe')
    addGroup(db, krippe, 'Igel')
    expect(childrenOverview(db, { ...admin, facilityId: krippe }, TODAY)).toEqual({ groups: [], children: [] })
  })
})
