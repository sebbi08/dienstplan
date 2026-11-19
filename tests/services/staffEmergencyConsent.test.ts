import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeEmergencyConsentLog } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { addEmergencyContact } from '../../server/services/emergencyContacts'
import {
  getEmployeeEmergencyConsent, getMyEmergencyConsent, getMyEmergencyContacts, listTabletEmergencyContacts, setEmployeeEmergencyConsent,
  setMyEmergencyConsent,
} from '../../server/services/staffEmergencyConsent'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const NOW = new Date('2026-10-06T06:00:00Z')
const LATER = new Date('2026-10-07T06:00:00Z')
const contact = (name: string, note = 'geheim') => ({ name, relation: 'Ehemann', phone: '0171 111', phone2: '0171 222', note })

describe('emergency contacts of the staff at the tablet, only with consent', () => {
  let db: Db
  let anna: number
  let berta: number
  let carla: number
  let annaUser: SessionUser
  let leitung: SessionUser
  let tablet: SessionUser
  const terminal = () => ({ id: tablet.id, facilityId: tablet.facilityId! })
  const unlock = (now = NOW, employeeId = berta, pin = '654321') => unlockChildren(db, terminal(), employeeId, pin, now).token
  const list = (token: string | undefined, now = NOW) => listTabletEmergencyContacts(db, terminal(), token, now)
  const names = (token: string | undefined, now = NOW) => list(token, now).map(row => row.name)

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    carla = addEmployee(db, 'Carla')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, berta, '654321')
    annaUser = addUser(db, 'anna', 'observer', anna)
    leitung = addUser(db, 'leitung', 'admin')
    tablet = addUser(db, 'tablet', 'terminal')
    addEmergencyContact(db, 1, anna, contact('Anton'))
    addEmergencyContact(db, 1, anna, { ...contact('Antonia'), relation: 'Schwester', phone2: '' })
    addEmergencyContact(db, 1, carla, contact('Claus'))
  })

  it('shows nobody by default, whatever contacts are entered', () => {
    expect(getMyEmergencyConsent(db, annaUser)).toEqual({
      consent: false, source: null, date: null, hasAccount: true, selfOnly: false, earliestWrittenDate: null,
    })
    expect(list(unlock())).toEqual([])
  })

  it('a locked tablet gets nothing', () => {
    setMyEmergencyConsent(db, annaUser, true, NOW)
    expect(errorCode(() => list(undefined))).toBe('tablet_locked')
    expect(errorCode(() => list('nonsense'))).toBe('tablet_locked')
    // The unlock runs out like for the child data (lock time 2 minutes, plus grace).
    const token = unlock()
    expect(names(token, new Date(NOW.getTime() + 60_000))).toEqual(['Anna'])
    expect(errorCode(() => list(token, new Date(NOW.getTime() + 3_600_000)))).toBe('tablet_locked')
  })

  it('the own consent shows the employee at the tablet, the withdrawal hides them at once', () => {
    setMyEmergencyConsent(db, annaUser, true, NOW)
    expect(getMyEmergencyConsent(db, annaUser)).toEqual({
      consent: true, source: 'self', date: '2026-10-06', hasAccount: true, selfOnly: true, earliestWrittenDate: null,
    })
    const token = unlock()
    expect(list(token)).toEqual([{
      employeeId: anna, name: 'Anna',
      contacts: [
        { name: 'Anton', relation: 'Ehemann', phone: '0171 111', phone2: '0171 222' },
        { name: 'Antonia', relation: 'Schwester', phone: '0171 111', phone2: '' },
      ],
    }])
    setMyEmergencyConsent(db, annaUser, false, NOW)
    expect(list(token)).toEqual([])
    expect(getMyEmergencyConsent(db, annaUser)).toMatchObject({ consent: false, source: 'self', selfOnly: false, earliestWrittenDate: '2026-10-06' })
  })

  it('never returns a note or anything else personal', () => {
    setMyEmergencyConsent(db, annaUser, true, NOW)
    const json = JSON.stringify(list(unlock()))
    expect(json).not.toContain('geheim')
    expect(json).not.toContain('note')
    expect(Object.keys(list(unlock())[0]!).sort()).toEqual(['contacts', 'employeeId', 'name'])
    expect(Object.keys(list(unlock())[0]!.contacts[0]!).sort()).toEqual(['name', 'phone', 'phone2', 'relation'])
  })

  it('an employee without contacts is not listed', () => {
    const dora = addEmployee(db, 'Dora')
    setEmployeeEmergencyConsent(db, leitung, 1, dora, { consent: true, date: '2026-10-01' }, NOW)
    expect(names(unlock())).toEqual([])
  })

  it('the unlock holds through a window without the automatic lock, like for the child data', () => {
    setMyEmergencyConsent(db, annaUser, true, NOW)
    // 08:00 Berlin; the window 07:00-09:00 keeps it unlocked, a lock time of 2 minutes would not.
    setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [{ start: 420, end: 540 }] })
    const token = unlock()
    expect(names(token, new Date(NOW.getTime() + 30 * 60_000))).toEqual(['Anna'])
    // Long after the window's end plus the lock time it is locked again.
    expect(errorCode(() => list(token, new Date(NOW.getTime() + 3 * 3_600_000)))).toBe('tablet_locked')
  })

  it('a written withdrawal without any record changes nothing and logs nothing; a later self consent works', () => {
    setEmployeeEmergencyConsent(db, leitung, 1, carla, { consent: false }, NOW)
    expect(db.select().from(employeeEmergencyConsentLog).all()).toEqual([])
    expect(getEmployeeEmergencyConsent(db, 1, carla)).toMatchObject({ consent: false, source: null })
    setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-10-01' }, NOW)
    setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: false }, NOW)
    setMyEmergencyConsent(db, annaUser, true, NOW)
    expect(names(unlock())).toEqual(['Anna'])
    expect(db.select().from(employeeEmergencyConsentLog).all().map(row => `${row.source}:${row.granted}`))
      .toEqual(['written:true', 'written:false', 'self:true'])
  })

  it('the employee sees their own contacts as colleagues would, without the note', () => {
    expect(getMyEmergencyContacts(db, annaUser)).toEqual([
      { name: 'Anton', relation: 'Ehemann', phone: '0171 111', phone2: '0171 222' },
      { name: 'Antonia', relation: 'Schwester', phone: '0171 111', phone2: '' },
    ])
    expect(getMyEmergencyContacts(db, addUser(db, 'berta', 'observer', berta))).toEqual([])
    expect(errorCode(() => getMyEmergencyContacts(db, addUser(db, 'leitung2', 'admin')))).toBe('no_employee')
  })

  it('needs an own account and an employee for the own switch', () => {
    const noEmployee = addUser(db, 'leitung2', 'admin')
    expect(errorCode(() => getMyEmergencyConsent(db, noEmployee))).toBe('no_employee')
    expect(errorCode(() => setMyEmergencyConsent(db, noEmployee, true, NOW))).toBe('no_employee')
  })

  it('Leitung records a written consent with its date, for an employee without account', () => {
    setEmployeeEmergencyConsent(db, leitung, 1, carla, { consent: true, date: '2026-09-20' }, NOW)
    expect(getEmployeeEmergencyConsent(db, 1, carla)).toEqual({
      consent: true, source: 'written', date: '2026-09-20', hasAccount: false, selfOnly: false, earliestWrittenDate: null,
    })
    expect(names(unlock())).toEqual(['Carla'])
    // ... and records the withdrawal, again in writing.
    setEmployeeEmergencyConsent(db, leitung, 1, carla, { consent: false }, NOW)
    expect(names(unlock())).toEqual([])
  })

  it('a written consent needs a valid day that is not in the future', () => {
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, carla, { consent: true }, NOW))).toBe('emergency_consent_date_invalid')
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, carla, { consent: true, date: '2026-10-07' }, NOW)))
      .toBe('emergency_consent_date_invalid')
    expect(names(unlock())).toEqual([])
  })

  it('Leitung cannot switch off or replace a consent the employee gave themselves', () => {
    setMyEmergencyConsent(db, annaUser, true, NOW)
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: false }, NOW))).toBe('emergency_consent_self_only')
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-10-05' }, NOW)))
      .toBe('emergency_consent_self_only')
    expect(getEmployeeEmergencyConsent(db, 1, anna)).toMatchObject({ consent: true, source: 'self', selfOnly: true })
  })

  it('Leitung cannot override a later withdrawal by the employee, only record a written consent with a later date', () => {
    setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-09-01' }, NOW)
    setMyEmergencyConsent(db, annaUser, false, NOW)
    expect(names(unlock())).toEqual([])
    // Not with the old date, not with the day of the withdrawal itself.
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-09-01' }, LATER)))
      .toBe('emergency_consent_withdrawn_by_self')
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-10-06' }, LATER)))
      .toBe('emergency_consent_withdrawn_by_self')
    expect(names(unlock())).toEqual([])
    // A new written declaration of a later day counts.
    setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-10-07' }, LATER)
    expect(names(unlock(LATER), LATER)).toEqual(['Anna'])
    expect(getEmployeeEmergencyConsent(db, 1, anna)).toMatchObject({ consent: true, source: 'written', date: '2026-10-07' })
  })

  it('the employee can switch their consent on again and off again after Leitung recorded one', () => {
    setEmployeeEmergencyConsent(db, leitung, 1, anna, { consent: true, date: '2026-09-01' }, NOW)
    setMyEmergencyConsent(db, annaUser, true, NOW)
    expect(getMyEmergencyConsent(db, annaUser)).toMatchObject({ consent: true, source: 'self', selfOnly: true })
    setMyEmergencyConsent(db, annaUser, false, NOW)
    expect(names(unlock())).toEqual([])
  })

  it('writes an immutable log entry for every change, and none when nothing changes', () => {
    setMyEmergencyConsent(db, annaUser, true, NOW)
    setMyEmergencyConsent(db, annaUser, true, NOW)
    setMyEmergencyConsent(db, annaUser, false, LATER)
    setEmployeeEmergencyConsent(db, leitung, 1, carla, { consent: true, date: '2026-09-20' }, NOW)
    const log = db.select().from(employeeEmergencyConsentLog).all()
    expect(log.map(({ id, ...rest }) => rest)).toEqual([
      { employeeId: anna, granted: true, source: 'self', by: 'self', at: NOW.toISOString(), date: '2026-10-06' },
      { employeeId: anna, granted: false, source: 'self', by: 'self', at: LATER.toISOString(), date: '2026-10-07' },
      { employeeId: carla, granted: true, source: 'written', by: 'leitung', at: NOW.toISOString(), date: '2026-09-20' },
    ])
  })

  it('lists only consenting employees of the tablet\'s facility who have not left', () => {
    const hort = addFacility(db, 'Hort')
    const otherPerson = addEmployee(db, 'Fremde', { facilityId: hort })
    addEmergencyContact(db, hort, otherPerson, contact('Fritz'))
    const left = addEmployee(db, 'Gone', { leftOn: '2026-09-01' })
    addEmergencyContact(db, 1, left, contact('Gerd'))
    const leaving = addEmployee(db, 'Leaving', { leftOn: '2026-10-06' })
    addEmergencyContact(db, 1, leaving, contact('Lars'))
    for (const id of [anna, carla, otherPerson, left, leaving]) {
      setEmployeeEmergencyConsent(db, leitung, id === otherPerson ? hort : 1, id, { consent: true, date: '2026-10-01' }, NOW)
    }
    // Nobody who did not consent shows (Berta, who unlocked, has no consent).
    expect(names(unlock())).toEqual(['Anna', 'Carla', 'Leaving'])
  })

  it('Leitung records only for employees of their own facility', () => {
    const hort = addFacility(db, 'Hort')
    const other = addEmployee(db, 'Fremde', { facilityId: hort })
    expect(errorCode(() => setEmployeeEmergencyConsent(db, leitung, 1, other, { consent: true, date: '2026-10-01' }, NOW)))
      .toBe('employee_not_found')
    expect(errorCode(() => getEmployeeEmergencyConsent(db, 1, other))).toBe('employee_not_found')
  })

})
