import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { groupMerges } from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import { groupMergeSchema } from '../../server/schemas'
import { arrive, getAttendanceDay, leave } from '../../server/services/childAttendance'
import { addContact } from '../../server/services/childContacts'
import { setChildSort } from '../../server/services/childSort'
import { activeGroupMerges, createGroupMerge, endGroupMerge } from '../../server/services/groupMerges'
import { deleteGroup } from '../../server/services/groups'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import { mergedPresent } from '../../shared/domain/groupMerges'
import {
  addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode,
} from '../helpers/fixtures'

const berlin = (date: string, time: string) => new Date(`${date}T${time}:00+02:00`)
const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

const TODAY = '2026-10-14' // a Wednesday
const YESTERDAY = '2026-10-13'
const NOW = berlin(TODAY, '07:30')

describe('merging groups at the edge times', () => {
  let db: Db
  let leitung: ChildActor
  let bears: number
  let mice: number
  let foxes: number
  let hedgehogs: number

  beforeEach(() => {
    db = createTestDb()
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    foxes = addGroup(db, 1, 'Füchse')
    hedgehogs = addGroup(db, 1, 'Igel')
  })

  const merge = (groupIds: number[], options: { date?: string; now?: Date; viewer?: ChildActor } = {}) =>
    createGroupMerge(db, options.viewer ?? leitung, { date: options.date ?? TODAY, groupIds }, options.now ?? NOW)
  const active = (date = TODAY) => activeGroupMerges(db, 1, date).map(entry => entry.groupIds)

  it('creates a merge of today, logs who merged, and ends it', () => {
    const id = merge([mice, bears])
    // In the groups' order.
    expect(activeGroupMerges(db, 1, TODAY)).toEqual([{ id, groupIds: [bears, mice], createdByName: 'leitung', createdAt: NOW.toISOString() }])

    endGroupMerge(db, leitung, id, berlin(TODAY, '09:00'))
    expect(active()).toEqual([])
    expect(db.select().from(groupMerges).get()).toMatchObject({
      facilityId: 1, date: TODAY, createdByName: 'leitung', endedAt: berlin(TODAY, '09:00').toISOString(), endedByName: 'leitung',
    })
    // Ended once; again (or an unknown id) is gone.
    expect(errorCode(() => endGroupMerge(db, leitung, id, NOW))).toBe('group_merge_not_found')
    expect(errorCode(() => endGroupMerge(db, leitung, 999, NOW))).toBe('group_merge_not_found')
    // The groups can be merged again afterwards.
    merge([bears, mice])
    expect(active()).toEqual([[bears, mice]])
  })

  it('allows several merges a day, but each group in only one at a time', () => {
    merge([bears, mice])
    merge([foxes, hedgehogs])
    expect(active()).toEqual([[bears, mice], [foxes, hedgehogs]])
    expect(errorCode(() => merge([mice, foxes]))).toBe('group_merge_taken')
    expect(errorCode(() => merge([bears, mice]))).toBe('group_merge_taken')
    expect(active()).toEqual([[bears, mice], [foxes, hedgehogs]])
  })

  it('needs at least two different groups', () => {
    expect(errorCode(() => merge([]))).toBe('group_merge_too_few')
    expect(errorCode(() => merge([bears]))).toBe('group_merge_too_few')
    expect(errorCode(() => merge([bears, bears]))).toBe('group_merge_too_few')
    expect(db.select().from(groupMerges).all()).toEqual([])
    // The body asks for whole positive ids.
    expect(() => groupMergeSchema.parse({ date: TODAY, groupIds: [1.5, 2] })).toThrow()
    expect(groupMergeSchema.parse({ date: TODAY, groupIds: [bears, mice] })).toEqual({ date: TODAY, groupIds: [bears, mice] })
  })

  it('refuses groups of another facility or unknown ones', () => {
    const hort = addFacility(db, 'Hort')
    const other = addGroup(db, hort, 'Raben')
    expect(errorCode(() => merge([bears, other]))).toBe('group_not_found')
    expect(errorCode(() => merge([bears, 999]))).toBe('group_not_found')
    expect(db.select().from(groupMerges).all()).toEqual([])
  })

  it('a merge of another facility is neither shown nor ended here', () => {
    const hort = addFacility(db, 'Hort')
    const ravens = addGroup(db, hort, 'Raben')
    const owls = addGroup(db, hort, 'Eulen')
    const hortLeitung = asChildViewer(addUser(db, 'hortleitung', 'admin', null, hort), hort)
    const id = merge([ravens, owls], { viewer: hortLeitung })
    expect(active()).toEqual([])
    expect(activeGroupMerges(db, hort, TODAY).map(entry => entry.groupIds)).toEqual([[ravens, owls]])
    expect(errorCode(() => endGroupMerge(db, leitung, id, NOW))).toBe('group_merge_not_found')
  })

  it('is made for today only; one of an earlier date is ignored and cannot be ended any more', () => {
    expect(errorCode(() => merge([bears, mice], { date: YESTERDAY }))).toBe('group_merge_not_today')
    expect(errorCode(() => merge([bears, mice], { date: '2026-10-15' }))).toBe('group_merge_not_today')
    // Made yesterday and never ended: today it is gone, by itself.
    const id = merge([bears, mice], { date: YESTERDAY, now: berlin(YESTERDAY, '16:00') })
    expect(active(YESTERDAY)).toEqual([[bears, mice]])
    expect(active()).toEqual([])
    expect(getAttendanceDay(db, leitung, TODAY, NOW).merges).toEqual([])
    expect(errorCode(() => endGroupMerge(db, leitung, id, NOW))).toBe('group_merge_not_found')
    // The groups are free today.
    merge([bears, mice])
    expect(active()).toEqual([[bears, mice]])
  })

  it('forgets a deleted group; a merge left with fewer than two groups ends', () => {
    merge([bears, mice, foxes])
    deleteGroup(db, 1, foxes, TODAY)
    expect(active()).toEqual([[bears, mice]])
    deleteGroup(db, 1, mice, TODAY)
    expect(active()).toEqual([])
    // Bären can be merged again.
    merge([bears, hedgehogs])
    expect(active()).toEqual([[bears, hedgehogs]])
  })

  it('can be made and ended at the tablet, also for groups that are not the person\'s own', () => {
    setTabletSettings(db, 1, { lockMinutes: 10, showWaitlist: true, showFutureContracts: true })
    const tablet = addUser(db, 'tablet', 'terminal')
    const anna = addEmployee(db, 'Anna Tablet', { groupId: bears })
    setPin(db, 1, anna, '123456')
    const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, anna, '123456', NOW).token
    const atTablet = resolveChildViewer(db, tablet, token, NOW) as ChildActor
    const id = merge([foxes, hedgehogs], { viewer: atTablet })
    expect(activeGroupMerges(db, 1, TODAY)[0]).toMatchObject({ groupIds: [foxes, hedgehogs], createdByName: 'Anna Tablet' })
    endGroupMerge(db, atTablet, id, NOW)
    expect(db.select().from(groupMerges).get()).toMatchObject({ endedByName: 'Anna Tablet' })
  })

  describe('in the day list', () => {
    const contact = {
      name: 'Anna Meier', relation: 'Mutter', phoneHome: '', phoneMobile: '0170 1', phoneWork: '', isGuardian: true,
      mayPickUp: true, emergencyRank: null, contactBan: false, contactBanNote: '', note: '',
    }

    it('lists today\'s merges with all children of their groups in the facility\'s order, and every group of the facility', () => {
      setChildSort(db, 1, 'first_asc')
      const zoe = addChild(db, 1, { firstName: 'Zoe', lastName: 'Bär', groupId: bears })
      const anna = addChild(db, 1, { firstName: 'Anna', lastName: 'Maus', groupId: mice })
      const mia = addChild(db, 1, { firstName: 'Mia', lastName: 'Bär', groupId: bears })
      addChild(db, 1, { firstName: 'Fritz', lastName: 'Fuchs', groupId: foxes })
      const id = merge([bears, mice])

      const day = getAttendanceDay(db, leitung, TODAY, NOW)
      expect(day.facilityGroups).toEqual([
        { id: bears, name: 'Bären' }, { id: mice, name: 'Mäuse' }, { id: foxes, name: 'Füchse' }, { id: hedgehogs, name: 'Igel' },
      ])
      // Across both groups by first name; who is here now the list decides (see shared/domain/groupMerges).
      expect(day.merges).toEqual([{ id, groupIds: [bears, mice], childIds: [anna, mia, zoe], createdByName: 'leitung', createdAt: NOW.toISOString() }])
      // Another day shows no merge.
      expect(getAttendanceDay(db, leitung, YESTERDAY, NOW).merges).toEqual([])
      // Ended: gone from the list at the next load.
      endGroupMerge(db, leitung, id, NOW)
      expect(getAttendanceDay(db, leitung, TODAY, NOW).merges).toEqual([])
    })

    it('shows in the section only who is here now: in after „Kommt“, out after „Geht“, at the next load', () => {
      const ben = addChild(db, 1, { firstName: 'Ben', lastName: 'Bär', groupId: bears })
      const lea = addChild(db, 1, { firstName: 'Lea', lastName: 'Maus', groupId: mice })
      const mom = addContact(db, leitung, 1, ben, contact, TODAY, NOW)
      merge([bears, mice])
      const section = () => {
        const day = getAttendanceDay(db, leitung, TODAY, berlin(TODAY, '09:00'))
        return mergedPresent(day.merges[0]!.childIds, day.children).map(child => child.childId)
      }
      expect(section()).toEqual([])
      arrive(db, leitung, { childId: ben, date: TODAY, time: hm('07:30'), plannedPickup: hm('15:00') }, NOW)
      arrive(db, leitung, { childId: lea, date: TODAY, time: hm('07:35'), plannedPickup: hm('15:00') }, NOW)
      expect(section()).toEqual([ben, lea])
      leave(db, leitung, { childId: ben, date: TODAY, time: hm('08:30'), pickup: { kind: 'contact', id: mom } }, berlin(TODAY, '08:30'))
      expect(section()).toEqual([lea])
    })
  })
})
