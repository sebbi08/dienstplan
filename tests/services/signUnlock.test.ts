import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeDocuments, signRequestRecipients, signRequests, signUnlocks, templateCategories } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { uploadTemplate, type TemplateActor } from '../../server/services/printTemplates'
import {
  createSignRequest, declineMyRequest, listMySignRequests, readMySignRequestFile, signMyRequest, type SignSender,
} from '../../server/services/signRequests'
import { lockSigning, tabletSigner, unlockForSigning } from '../../server/services/signUnlock'
import { lockChildren, tabletChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { createCategory } from '../../server/services/templateCategories'
import { setPin } from '../../server/services/terminal'
import { fillablePdf } from '../helpers/fillablePdf'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

/**
 * „Zu unterschreiben“ at the tablet: a sign-only unlock with the PIN, short (3 minutes idle, 10 at most, also inside a
 * window without the automatic lock), never the child records, only the person's own requests of the tablet's facility.
 */

const NOW = new Date('2026-11-24T09:00:00.000Z')
const after = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)
const signedCopy = () => Buffer.concat([fillablePdf(), Buffer.from('% signed\n')])

describe('the tablet unlocked for signing', () => {
  let db: Db
  let anna: number
  let ben: number
  let tablet: { id: number; facilityId: number }
  let annasRecipient: number
  let bensRecipient: number

  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna Probe')
    ben = addEmployee(db, 'Ben Beispiel')
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setPin(db, 1, anna, '123456')
    setPin(db, 1, ben, '654321')
    const account = addUser(db, 'tablet', 'terminal')
    tablet = { id: account.id, facilityId: account.facilityId! }
    const admin = addUser(db, 'leitung', 'admin')
    const sender: SignSender = { id: admin.id, role: admin.role, permissions: admin.permissions, facilityId: 1 }
    db.delete(templateCategories).run()
    const actor: TemplateActor = { ...sender }
    const categoryId = createCategory(db, actor, { name: 'Personal', visibility: 'all' })
    const templateId = uploadTemplate(db, actor, { title: 'Belehrung', categoryId, scope: 'facility' }, { data: fillablePdf(), filename: 'b.pdf' }, NOW)
    createSignRequest(db, sender, {
      title: 'Belehrung', sourceKind: 'template', sourceId: templateId, recipientIds: [anna, ben], folder: 'qualifications', dueDate: null, note: '',
    }, null, NOW)
    const recipient = (employeeId: number) =>
      db.select().from(signRequestRecipients).where(eq(signRequestRecipients.employeeId, employeeId)).get()!.id
    annasRecipient = recipient(anna)
    bensRecipient = recipient(ben)
  })

  const unlock = (employeeId = anna, pin = '123456', now = NOW) => unlockForSigning(db, tablet, employeeId, pin, now)

  it('unlocks with the PIN for the person\'s own requests only; a wrong PIN or a person not on the list does not', () => {
    expect(errorCode(() => unlock(anna, '000000'))).toBe('pin_invalid')
    const stranger = addEmployee(db, 'Cora Krippe', { facilityId: addFacility(db, 'Krippe') })
    expect(errorCode(() => unlock(stranger, '123456'))).toBe('employee_not_found')
    expect(db.select().from(signUnlocks).all()).toEqual([])
    const token = unlock()
    const signer = tabletSigner(db, tablet, token, after(10))
    expect(signer).toEqual({ employeeId: anna, userId: null, facilityId: 1 })
    expect(listMySignRequests(db, signer, '2026-11-24').requests.map(request => request.recipientId)).toEqual([annasRecipient])
    // Ben's request is not found, neither to read, sign nor decline.
    expect(errorCode(() => readMySignRequestFile(db, signer, bensRecipient))).toBe('sign_request_not_found')
    expect(errorCode(() => signMyRequest(db, signer, bensRecipient, signedCopy(), after(20)))).toBe('sign_request_not_found')
    expect(errorCode(() => declineMyRequest(db, signer, bensRecipient, 'nein', after(20)))).toBe('sign_request_not_found')
    // Anna signs; her own account (if any) is named as uploader, else none.
    const { documentId } = signMyRequest(db, signer, annasRecipient, signedCopy(), after(30))
    expect(db.select({ uploadedBy: employeeDocuments.uploadedBy }).from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get())
      .toEqual({ uploadedBy: null })
  })

  it('names the person\'s own account as uploader at the tablet', () => {
    const account = addUser(db, 'anna', 'observer', anna)
    const signer = tabletSigner(db, tablet, unlock(), after(5))
    const { documentId } = signMyRequest(db, signer, annasRecipient, signedCopy(), after(30))
    expect(db.select({ uploadedBy: employeeDocuments.uploadedBy }).from(employeeDocuments).where(eq(employeeDocuments.id, documentId)).get())
      .toEqual({ uploadedBy: account.id })
  })

  it('is locked without a token, with another tablet\'s, after locking and when a new PIN replaced it', () => {
    expect(errorCode(() => tabletSigner(db, tablet, undefined, NOW))).toBe('sign_locked')
    expect(errorCode(() => tabletSigner(db, tablet, 'erfunden', NOW))).toBe('sign_locked')
    const token = unlock()
    const other = addUser(db, 'tablet-2', 'terminal')
    expect(errorCode(() => tabletSigner(db, { id: other.id, facilityId: 1 }, token, NOW))).toBe('sign_locked')
    // The same account moved to another facility.
    expect(errorCode(() => tabletSigner(db, { id: tablet.id, facilityId: addFacility(db, 'Hort') }, token, NOW))).toBe('sign_locked')
    // Ben's PIN ends Anna's unlock on this tablet.
    const bens = unlock(ben, '654321', after(5))
    expect(errorCode(() => tabletSigner(db, tablet, token, after(6)))).toBe('sign_locked')
    expect(tabletSigner(db, tablet, bens, after(6)).employeeId).toBe(ben)
    // Locking with an old token does not end the current one; with the current one it does.
    lockSigning(db, tablet.id, token)
    expect(tabletSigner(db, tablet, bens, after(7)).employeeId).toBe(ben)
    lockSigning(db, tablet.id, bens)
    expect(errorCode(() => tabletSigner(db, tablet, bens, after(8)))).toBe('sign_locked')
    expect(db.select().from(signUnlocks).all()).toEqual([])
  })

  it('ends 3 minutes after the last use and 10 minutes after the PIN, also in a window without the automatic lock', () => {
    // 9:00 to 11:00 (NOW is 10:00 Berlin time) without the automatic lock for the child records: the sign unlock does not care.
    setTabletSettings(db, 1, { lockMinutes: 2, showWaitlist: false, showFutureContracts: false, noLockWindows: [{ start: 9 * 60, end: 11 * 60 }] }, NOW)
    const idle = unlock()
    expect(tabletSigner(db, tablet, idle, after(179)).employeeId).toBe(anna)
    // 3 minutes after that use: over, and the row is gone.
    expect(errorCode(() => tabletSigner(db, tablet, idle, after(179 + 181)))).toBe('sign_locked')
    expect(db.select().from(signUnlocks).all()).toEqual([])

    const busy = unlock(anna, '123456', after(400))
    // Used every two minutes: still at most 10 minutes after the PIN.
    for (let second = 520; second < 400 + 600; second += 120) expect(tabletSigner(db, tablet, busy, after(second)).employeeId).toBe(anna)
    expect(errorCode(() => tabletSigner(db, tablet, busy, after(400 + 601)))).toBe('sign_locked')
  })

  it('is apart from the child records: the sign unlock opens no child record, a child unlock signs nothing', () => {
    const signToken = unlock()
    expect(errorCode(() => tabletChildViewer(db, tablet, signToken, after(5)))).toBe('tablet_locked')
    const { token: childToken } = unlockChildren(db, tablet, anna, '123456', after(10))
    expect(errorCode(() => tabletSigner(db, tablet, childToken, after(11)))).toBe('sign_locked')
    // Each lock ends only its own unlock.
    lockChildren(db, tablet.id, childToken)
    expect(tabletSigner(db, tablet, signToken, after(12)).employeeId).toBe(anna)
    lockSigning(db, tablet.id, signToken)
    expect(tabletChildViewer(db, tablet, unlockChildren(db, tablet, anna, '123456', after(13)).token, after(14)).employeeId).toBe(anna)
  })

  it('shows at the tablet only the requests of its facility (the own account shows all of the person\'s)', () => {
    const hort = addFacility(db, 'Hort')
    // The request came from another facility (Anna worked there before).
    db.update(signRequests).set({ facilityId: hort }).run()
    const signer = tabletSigner(db, tablet, unlock(), after(5))
    expect(listMySignRequests(db, signer, '2026-11-24').requests).toEqual([])
    expect(errorCode(() => readMySignRequestFile(db, signer, annasRecipient))).toBe('sign_request_not_found')
    expect(errorCode(() => signMyRequest(db, signer, annasRecipient, signedCopy(), after(10)))).toBe('sign_request_not_found')
    expect(listMySignRequests(db, { employeeId: anna }, '2026-11-24').requests).toHaveLength(1)
  })
})
