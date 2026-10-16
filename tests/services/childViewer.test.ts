import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childDocuments, terminalUnlocks, users } from '../../server/db/schema'
import { asChildEditor, asChildManager, type ChildActor } from '../../server/lib/childViewer'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { readDocumentFile, uploadDocument } from '../../server/services/childDocuments'
import { getChild, listPlanned, updateChildHealth } from '../../server/services/children'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { setPin } from '../../server/services/terminal'
import type { ChildHealthInput, SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addUser, asChildViewer, createTestDb, documentTypeId, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-06'
const NOW = new Date('2026-10-06T06:00:00Z')
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('content')])
const HEALTH: ChildHealthInput = {
  measlesProof: true, measlesProofDate: null, infectionBriefingDate: null, allergies: '',
  mayTakeTemperature: false, mayApplySunscreen: false, mayApplyPlaster: false,
}

describe('the child viewer', () => {
  let db: Db
  let anna: number
  let berta: number
  let tablet: SessionUser
  const unlock = (employeeId = anna, pin = '1234') =>
    unlockChildren(db, { id: tablet.id, facilityId: tablet.facilityId! }, employeeId, pin, NOW).token
  const settings = (changes: { showWaitlist?: boolean; showFutureContracts?: boolean } = {}) =>
    setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, ...changes })

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '1234')
    setPin(db, 1, berta, '4321')
    tablet = addUser(db, 'tablet', 'terminal')
  })

  it('a Mitarbeiter account gets no child data', () => {
    const observer = addUser(db, 'anna', 'observer', anna)
    expect(errorCode(() => resolveChildViewer(db, observer, undefined, NOW))).toBe('children_tablet_only')
    expect(errorCode(() => resolveChildViewer(db, { ...observer, canEditChildren: true }, undefined, NOW))).toBe('children_tablet_only')
    // Not even with the token of a valid unlock of the tablet.
    expect(errorCode(() => resolveChildViewer(db, observer, unlock(), NOW))).toBe('children_tablet_only')
  })

  it('Leitung and Träger keep their access', () => {
    const leitung = addUser(db, 'leitung', 'admin')
    const traeger = addUser(db, 'traeger', 'provider')
    expect(resolveChildViewer(db, leitung, undefined, NOW)).toEqual({
      id: leitung.id, employeeId: null, name: 'leitung', role: 'admin', canEditChildren: leitung.canEditChildren, facilityId: 1,
      visibility: null, onTablet: false, groups: null,
    })
    expect(resolveChildViewer(db, traeger, undefined, NOW)).toEqual({
      id: traeger.id, employeeId: null, name: 'traeger', role: 'provider', canEditChildren: traeger.canEditChildren, facilityId: 1,
      visibility: null, onTablet: false, groups: null,
    })
    // An account linked with an employee is named like the employee.
    const linked = addUser(db, 'leitung-berta', 'admin', berta)
    expect(resolveChildViewer(db, linked, undefined, NOW)).toMatchObject({ id: linked.id, employeeId: berta, name: 'Berta' })
    expect(errorCode(() => resolveChildViewer(db, { ...traeger, facilityId: null }, undefined, NOW))).toBe('no_facility')
  })

  it('the tablet needs an unlock', () => {
    expect(errorCode(() => resolveChildViewer(db, tablet, undefined, NOW))).toBe('tablet_locked')
    expect(errorCode(() => resolveChildViewer(db, tablet, 'nonsense', NOW))).toBe('tablet_locked')
    const token = unlock()
    const later = new Date(NOW.getTime() + 60_000)
    expect(resolveChildViewer(db, tablet, token, later)).toEqual({
      id: null, employeeId: anna, name: 'Anna', role: 'observer', canEditChildren: false, facilityId: 1,
      visibility: { waitlist: false, futureContracts: false }, onTablet: true, groups: null,
    })
    // Every request at the tablet counts as use and keeps it unlocked.
    expect(db.select().from(terminalUnlocks).get()!.lastActiveAt).toBe(later.toISOString())
  })

  it('the editor and manager checks refuse an unlocked Mitarbeiter by their rights', () => {
    // These are the decisions requireChildEditor( and requireChildManager( apply to the viewer of the request.
    const account = addUser(db, 'anna', 'observer', anna)
    const reader = resolveChildViewer(db, tablet, unlock(), NOW)
    expect(reader).toMatchObject({ id: account.id, role: 'observer', canEditChildren: false, onTablet: true })
    expect(errorCode(() => asChildEditor(reader))).toBe('forbidden')
    expect(errorCode(() => asChildManager(reader))).toBe('forbidden')

    // With the permission: maintains records, but the manager pages stay closed.
    db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
    const editor = resolveChildViewer(db, tablet, unlock(), NOW)
    expect(asChildEditor(editor)).toMatchObject({ id: account.id })
    expect(errorCode(() => asChildManager(editor))).toBe('forbidden')

    // Without an account (PIN only) only reading, even if the Leitung set nothing else.
    const pinOnly = resolveChildViewer(db, tablet, unlock(berta, '4321'), NOW)
    expect(pinOnly).toMatchObject({ id: null, onTablet: true })
    expect(errorCode(() => asChildEditor(pinOnly))).toBe('forbidden')
    expect(errorCode(() => asChildManager(pinOnly))).toBe('forbidden')

    // An unlocked Leitung passes both.
    const leitung = addUser(db, 'leitung', 'admin', berta)
    const manager = resolveChildViewer(db, tablet, unlock(berta, '4321'), NOW)
    expect(asChildEditor(manager)).toMatchObject({ id: leitung.id, onTablet: true })
    expect(asChildManager(manager)).toMatchObject({ id: leitung.id, onTablet: true })
  })

  describe('hidden planned children at the tablet', () => {
    let waitlist: number
    let future: number
    let undated: number
    let active: number
    let waitlistDocument: number

    beforeEach(() => {
      settings()
      waitlist = addChild(db, 1, { lastName: 'Vormerkung', admissionStatus: 'waitlist', entryDate: null, waitlistedOn: '2026-09-01' })
      future = addChild(db, 1, { lastName: 'Zukunft', entryDate: '2026-11-01' })
      undated = addChild(db, 1, { lastName: 'Ohnedatum', entryDate: null })
      active = addChild(db, 1, { lastName: 'Aktiv' })
      const leitung = asChildViewer(addUser(db, 'leitung-buero', 'admin'))
      waitlistDocument = uploadDocument(db, leitung, 1, waitlist, {
        typeId: documentTypeId(db, 1, 'Sonstiges'), title: 'Anmeldung', documentDate: '2026-09-01', confidential: false,
      }, { data: pdf(), filename: 'anmeldung.pdf' }, TODAY, NOW)
    })

    const ids = (planned: ReturnType<typeof listPlanned>) =>
      ({ waitlist: planned.waitlist.map(child => child.id), contracted: planned.contracted.map(child => child.id) })

    it('hides them from a reader while the switches are off', () => {
      const viewer = resolveChildViewer(db, tablet, unlock(), NOW)
      expect(listPlanned(db, viewer, TODAY)).toEqual({ waitlist: [], contracted: [] })
      for (const id of [waitlist, future, undated]) expect(errorCode(() => getChild(db, viewer, id, TODAY))).toBe('child_not_found')
      expect(errorCode(() => readDocumentFile(db, viewer, 1, waitlistDocument, TODAY))).toBe('document_not_found')
      expect(getChild(db, viewer, active, TODAY).id).toBe(active)
    })

    it('shows the waitlist once it is switched on, the contract children stay hidden', () => {
      settings({ showWaitlist: true })
      const viewer = resolveChildViewer(db, tablet, unlock(), NOW)
      expect(ids(listPlanned(db, viewer, TODAY))).toEqual({ waitlist: [waitlist], contracted: [] })
      expect(getChild(db, viewer, waitlist, TODAY).id).toBe(waitlist)
      expect(readDocumentFile(db, viewer, 1, waitlistDocument, TODAY).data.equals(pdf())).toBe(true)
      for (const id of [future, undated]) expect(errorCode(() => getChild(db, viewer, id, TODAY))).toBe('child_not_found')
    })

    it('does not let an unlocked editor change a hidden child', () => {
      const account = addUser(db, 'anna', 'observer', anna)
      db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
      const viewer = resolveChildViewer(db, tablet, unlock(), NOW) as ChildActor
      expect(errorCode(() => updateChildHealth(db, viewer, 1, waitlist, HEALTH, TODAY, NOW))).toBe('child_not_found')
      expect(errorCode(() => updateChildHealth(db, viewer, 1, active, HEALTH, TODAY, NOW))).toBeNull()
    })

    it('shows every child to an unlocked Leitung', () => {
      addUser(db, 'leitung', 'admin', berta)
      const viewer = resolveChildViewer(db, tablet, unlock(berta, '4321'), NOW)
      expect(viewer).toMatchObject({ role: 'admin', visibility: null, onTablet: true })
      expect(ids(listPlanned(db, viewer, TODAY))).toEqual({ waitlist: [waitlist], contracted: [future, undated] })
      for (const id of [waitlist, future, undated, active]) expect(getChild(db, viewer, id, TODAY).id).toBe(id)
      expect(readDocumentFile(db, viewer, 1, waitlistDocument, TODAY).mimeType).toBe('application/pdf')
    })
  })

  it('an unlocked editor\'s change is stored under the account', () => {
    const account = addUser(db, 'anna', 'observer', anna)
    db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()
    const child = addChild(db, 1)
    const viewer = resolveChildViewer(db, tablet, unlock(), NOW)
    expect(viewer).toMatchObject({ id: account.id, canEditChildren: true, onTablet: true })
    const id = uploadDocument(db, viewer as ChildActor, 1, child, {
      typeId: documentTypeId(db, 1, 'Sonstiges'), title: 'Foto', documentDate: TODAY, confidential: false,
    }, { data: pdf(), filename: 'foto.pdf' }, TODAY, NOW)
    expect(db.select().from(childDocuments).where(eq(childDocuments.id, id)).get()!.uploadedBy).toBe(account.id)
  })
})
