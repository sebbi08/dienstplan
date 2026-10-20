import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import type { ChildActor } from '../../server/lib/childViewer'
import { capacityCells, capacityWarnings } from '../../server/services/capacityWarnings'
import { deleteGroupChange, planGroupChange, updateGroupChange } from '../../server/services/childGroupChanges'
import { createChild, leaveChild, unleaveChild, updateChildMaster } from '../../server/services/children'
import { setFacilityCapacity } from '../../server/services/facilities'
import { setGroupCapacity } from '../../server/services/groups'
import { childGroupChanges } from '../../server/db/schema'
import type { ChildMasterInput, KeepSection } from '../../shared/types/api'
import { addChild, addUser, addGroup, asChildViewer, createTestDb } from '../helpers/fixtures'

const TODAY = '2026-10-20'
const NOW = new Date('2026-10-20T08:30:00.000Z')
const KEEP_ALL: Record<KeepSection, boolean> = {
  contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true,
}
// Born 2024-01-01: school start 2030-09-01, so every child stays until 2030-08-31.
const BIRTH = '2024-01-01'

const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
  lastName: 'Neu', firstName: 'Nora', birthDate: BIRTH, address: '', groupId: null, careTypeId: null,
  entryDate: '2026-11-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
  schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null, ...overrides,
})

describe('capacity warnings', () => {
  let db: Db
  let admin: ChildActor
  let bears: number
  let mice: number
  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    setGroupCapacity(db, 1, bears, 2)
    addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: BIRTH })
    addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: BIRTH })
  })

  const traeger = () => addUser(db, 'traeger', 'provider')

  /** What a route does: the cells before, the save, the warnings for what the save added. */
  function saving(childId: number | null, save: () => number | void, viewer: { role: ChildActor['role'] } = admin) {
    const before = capacityCells(db, 1, childId, TODAY)
    const id = save() ?? childId!
    return capacityWarnings(db, viewer, 1, id, before, TODAY)
  }

  it('warns when a new child takes a group over its places, from the first month it is over', () => {
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears }), NOW))).toEqual([
      { kind: 'group', name: 'Bären', count: 3, capacity: 2, year: 2026, month: 11 },
    ])
  })

  it('does not warn at the places, below them, or for a group without places', () => {
    setGroupCapacity(db, 1, bears, 3)
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears }), NOW))).toEqual([])
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: mice, firstName: 'Mia' }), NOW))).toEqual([])
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: null, firstName: 'Ole' }), NOW))).toEqual([])
  })

  it('warns when the facility goes over its maximum, also into a group without places', () => {
    setFacilityCapacity(db, traeger(), 1, 2)
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: mice }), NOW))).toEqual([
      { kind: 'facility', name: 'Kindergarten', count: 3, capacity: 2, year: 2026, month: 11 },
    ])
    // Group and facility at once, with the highest number of children over the months.
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears, firstName: 'Mia', entryDate: '2027-02-01' }), NOW))).toEqual([
      { kind: 'group', name: 'Bären', count: 3, capacity: 2, year: 2027, month: 2 },
      { kind: 'facility', name: 'Kindergarten', count: 4, capacity: 2, year: 2027, month: 2 },
    ])
  })

  it('only looks at the months from today on', () => {
    // Over in September 2026 only: the third child leaves before this month.
    addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: BIRTH, leftOn: '2026-09-30' })
    setFacilityCapacity(db, traeger(), 1, 3)
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: mice, entryDate: '2026-09-01' }), NOW))).toEqual([])
  })

  it('warns for a group change in the master data and for a planned group change, from its day on', () => {
    const anna = addChild(db, 1, { groupId: mice, entryDate: '2025-09-01', birthDate: BIRTH })
    setFacilityCapacity(db, traeger(), 1, 2)
    // The facility was over before already and the child was counted: no facility warning.
    expect(saving(anna, () => updateChildMaster(db, admin, 1, anna, { ...master({ groupId: bears, firstName: 'Anna', entryDate: '2025-09-01' }), baseGroupId: mice }, TODAY, NOW)))
      .toEqual([{ kind: 'group', name: 'Bären', count: 3, capacity: 2, year: 2026, month: 10 }])

    const ben = addChild(db, 1, { groupId: mice, entryDate: '2025-09-01', birthDate: BIRTH })
    expect(saving(ben, () => planGroupChange(db, admin, 1, ben, { groupId: bears, date: '2027-01-01', keep: KEEP_ALL }, TODAY, NOW)))
      .toEqual([{ kind: 'group', name: 'Bären', count: 4, capacity: 2, year: 2027, month: 1 }])
    const changeId = db.select().from(childGroupChanges).all().find(row => row.childId === ben && row.appliedAt === null)!.id
    // Moved earlier: the months it adds are over too.
    expect(saving(ben, () => updateGroupChange(db, admin, 1, changeId, { groupId: bears, date: '2026-12-01', keep: KEEP_ALL }, TODAY, NOW)))
      .toEqual([{ kind: 'group', name: 'Bären', count: 4, capacity: 2, year: 2026, month: 12 }])
    // Deleting it takes the child out of Bären again.
    expect(saving(ben, () => deleteGroupChange(db, 1, changeId, TODAY, NOW))).toEqual([])
  })

  it('warns when a Vormerkung gets a contract, and when a leaving is taken back', () => {
    const wish = addChild(db, 1, { groupId: bears, admissionStatus: 'waitlist', entryDate: null, plannedEntryDate: '2026-12-01', waitlistedOn: '2026-05-01', birthDate: BIRTH })
    expect(saving(wish, () => updateChildMaster(db, admin, 1, wish, {
      ...master({ groupId: bears, firstName: 'Wiebke', entryDate: null, plannedEntryDate: '2026-12-01' }), baseGroupId: bears,
    }, TODAY, NOW))).toEqual([{ kind: 'group', name: 'Bären', count: 3, capacity: 2, year: 2026, month: 12 }])

    const lena = addChild(db, 1, { groupId: mice, entryDate: '2025-09-01', birthDate: BIRTH })
    setFacilityCapacity(db, traeger(), 1, 2)
    leaveChild(db, 1, lena, '2026-10-31', TODAY)
    // From November on Lena counts again: 3 children then, 4 from December (Wiebke).
    expect(saving(lena, () => unleaveChild(db, 1, lena, TODAY))).toEqual([
      { kind: 'facility', name: 'Kindergarten', count: 4, capacity: 2, year: 2026, month: 11 },
    ])
  })

  it('does not warn for a save that adds nothing, and never to someone who does not see the places', () => {
    const anna = addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: BIRTH })
    // Bären has 3 of 2, but the child was there before.
    expect(saving(anna, () => updateChildMaster(db, admin, 1, anna, { ...master({ groupId: bears, firstName: 'Anna', entryDate: '2025-09-01', note: 'x' }), baseGroupId: bears }, TODAY, NOW)))
      .toEqual([])
    expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears }), NOW), { role: 'observer' })).toEqual([])
  })
})
