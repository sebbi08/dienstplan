import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { users } from '../../server/db/schema'
import { asChildEditor, asChildManager, asChildPermission, type ChildViewer } from '../../server/lib/childViewer'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getActiveUser } from '../../server/services/auth'
import { getChild } from '../../server/services/children'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { listChildGroups } from '../../server/services/groups'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import type { SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addGroup, addUser, createTestDb, errorCode, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-10-06'
const NOW = new Date('2026-10-06T06:00:00Z')
const PIN = '123456'

/**
 * Rechte und Rollen Teil 1, review focus 2 and 3: at the tablet the unlocking person's permissions decide, with the
 * group scope as before (own group write, readable groups read, other groups none; no home group = every group).
 */
describe('child permissions at the tablet', () => {
  let db: Db
  let tablet: SessionUser
  let mice: number
  let owls: number
  let bears: number
  let kids: { mice: number; owls: number; bears: number }

  /** The tablet unlocked by the employee, as the child guards see it. */
  function unlockedBy(employeeId: number): ChildViewer {
    setPin(db, 1, employeeId, PIN)
    const { token } = unlockChildren(db, { id: tablet.id, facilityId: 1 }, employeeId, PIN, NOW)
    return resolveChildViewer(db, tablet, token, NOW)
  }
  const rights = (viewer: ChildViewer) =>
    Object.fromEntries(listChildGroups(db, viewer).map(group => [group.id, group.right]))
  const canEdit = (viewer: ChildViewer, childId: number) => getChild(db, viewer, childId, TODAY, NOW).canEdit
  const flagged = (account: SessionUser) =>
    db.update(users).set({ canEditChildren: true }).where(eq(users.id, account.id)).run()

  beforeEach(() => {
    db = createTestDb()
    setTimeTrackingFrom(db, 1, '2026-10-01')
    tablet = addUser(db, 'tablet', 'terminal')
    mice = addGroup(db, 1, 'Mäuse')
    owls = addGroup(db, 1, 'Eulen')
    bears = addGroup(db, 1, 'Bären')
    setReadAccess(db, 1, mice, [owls])
    kids = {
      mice: addChild(db, 1, { groupId: mice }),
      owls: addChild(db, 1, { groupId: owls }),
      bears: addChild(db, 1, { groupId: bears }),
    }
  })

  it('a Mitarbeiter with a home group writes in the own group, reads the readable ones and sees no other', () => {
    const anna = addEmployee(db, 'Anna', { groupId: mice })
    flagged(addUser(db, 'anna', 'observer', anna))
    const viewer = unlockedBy(anna)
    expect(viewer.permissions).toEqual(permissionsOf('observer', true))
    expect(viewer.groups).toEqual({ own: mice, readable: [owls] })
    expect(rights(viewer)).toEqual({ [mice]: 'write', [owls]: 'read' })
    expect(canEdit(viewer, kids.mice)).toBe(true)
    expect(canEdit(viewer, kids.owls)).toBe(false)
    expect(errorCode(() => getChild(db, viewer, kids.bears, TODAY, NOW))).toBe('child_not_found')
    expect(asChildEditor(viewer).id).not.toBeNull()
    expect(errorCode(() => asChildManager(viewer))).toBe('forbidden')
  })

  it('a Springer without a group works in every group', () => {
    const berta = addEmployee(db, 'Berta')
    flagged(addUser(db, 'berta', 'observer', berta))
    const viewer = unlockedBy(berta)
    expect(viewer.groups).toBeNull()
    expect(rights(viewer)).toEqual({ [mice]: 'write', [owls]: 'write', [bears]: 'write' })
    for (const child of Object.values(kids)) expect(canEdit(viewer, child)).toBe(true)
  })

  it('a person without account has the Mitarbeiter defaults: reads and keeps attendance, changes no record', () => {
    const carla = addEmployee(db, 'Carla', { groupId: mice })
    const viewer = unlockedBy(carla)
    expect(viewer).toMatchObject({ id: null, role: 'observer', onTablet: true, groups: { own: mice, readable: [owls] } })
    expect(viewer.permissions).toEqual(permissionsOf('observer'))
    expect(asChildPermission(viewer, 'children.view')).toBe(viewer)
    expect(asChildPermission(viewer, 'children.attendance')).toBe(viewer)
    expect(errorCode(() => asChildEditor(viewer))).toBe('forbidden')
    expect(errorCode(() => asChildManager(viewer))).toBe('forbidden')
    expect(rights(viewer)).toEqual({ [mice]: 'write', [owls]: 'read' })
    expect(canEdit(viewer, kids.mice)).toBe(false)
    // Without children.planned the tablet switches decide which planned children show.
    expect(viewer.visibility).not.toBeNull()
  })

  it('a Mitarbeiter with „darf Kinderakten pflegen“ edits at the tablet, but gets no child data with the own account', () => {
    const anna = addEmployee(db, 'Anna')
    const account = addUser(db, 'anna', 'observer', anna)
    flagged(account)
    // The session user as the server loads it on every request: with children.edit, but without children.ownAccount.
    const office = getActiveUser(db, account.id, TODAY)!
    expect(office.permissions).toEqual(permissionsOf('observer', true))
    expect(errorCode(() => resolveChildViewer(db, office, undefined, NOW))).toBe('children_tablet_only')
    const viewer = unlockedBy(anna)
    expect(asChildEditor(viewer)).toMatchObject({ id: account.id, onTablet: true })
    expect(canEdit(viewer, kids.mice)).toBe(true)
  })

  it('the Leitung at the tablet has its own permissions: every group, planned children, the manager pages', () => {
    const dora = addEmployee(db, 'Dora', { groupId: mice })
    const account = addUser(db, 'dora', 'admin', dora)
    const viewer = unlockedBy(dora)
    expect(viewer.permissions).toEqual(account.permissions)
    expect(viewer).toMatchObject({ groups: null, visibility: null })
    expect(asChildManager(viewer)).toMatchObject({ id: account.id })
    expect(rights(viewer)).toEqual({ [mice]: 'write', [owls]: 'write', [bears]: 'write' })
  })
})
