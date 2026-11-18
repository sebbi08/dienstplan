import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { groupAgeLimits } from '../../server/db/schema'
import type { ChildActor } from '../../server/lib/childViewer'
import {
  ageLimitCells, ageLimitWarnings, listGroupAgeLimits, setGroupAgeLimits, upcomingAgeLimitWarnings,
} from '../../server/services/ageLimits'
import { planGroupChange } from '../../server/services/childGroupChanges'
import { createChild, leaveChild, updateChildMaster } from '../../server/services/children'
import { createFacility } from '../../server/services/facilities'
import { deleteGroup } from '../../server/services/groups'
import { occupancyTable } from '../../server/services/occupancy'
import type { ChildMasterInput, KeepSection } from '../../shared/types/api'
import { addChild, addGroup, addUser, asChildViewer, createTestDb, permissionsOf } from '../helpers/fixtures'

const TODAY = '2026-11-18'
const NOW = new Date('2026-11-18T08:30:00.000Z')
const KEEP_ALL: Record<KeepSection, boolean> = {
  contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true,
}

const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
  lastName: 'Neu', firstName: 'Nora', birthDate: '2025-05-10', address: '', groupId: null, careTypeId: null,
  entryDate: '2026-12-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
  schoolDistrict: '', keyEducatorId: null, note: '', admissionStatus: 'contract', waitlistedOn: null, ...overrides,
})

describe('group age limits', () => {
  let db: Db
  let admin: ChildActor
  let bears: number
  let mice: number
  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
  })

  describe('the rules', () => {
    it('stores the list of a group, replacing the former one, ordered by age', () => {
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 5 }])
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 2, toYears: 3, maxChildren: 3 }, { fromYears: 0, toYears: 3, maxChildren: 5 }])
      expect(listGroupAgeLimits(db, 1, bears)).toEqual([
        { fromYears: 0, toYears: 3, maxChildren: 5 }, { fromYears: 2, toYears: 3, maxChildren: 3 },
      ])
      expect(listGroupAgeLimits(db, 1, mice)).toEqual([])
      setGroupAgeLimits(db, 1, bears, [])
      expect(listGroupAgeLimits(db, 1, bears)).toEqual([])
    })

    it('rejects invalid rules with German error codes and keeps the stored list', () => {
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 5 }])
      expect(() => setGroupAgeLimits(db, 1, bears, [{ fromYears: 3, toYears: 2, maxChildren: 1 }])).toThrow('age_limit_range_invalid')
      expect(() => setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 19, maxChildren: 1 }])).toThrow('age_limit_years_invalid')
      expect(() => setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: -1 }])).toThrow('age_limit_max_invalid')
      const many = Array.from({ length: 21 }, () => ({ fromYears: 0, toYears: 3, maxChildren: 1 }))
      expect(() => setGroupAgeLimits(db, 1, bears, many)).toThrow('age_limits_too_many')
      const twice = [{ fromYears: 0, toYears: 3, maxChildren: 4 }, { fromYears: 0, toYears: 3, maxChildren: 4 }]
      expect(() => setGroupAgeLimits(db, 1, bears, twice)).toThrow('age_limit_duplicate')
      let refused: unknown = null
      try {
        setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 4 }, { fromYears: 5, toYears: 4, maxChildren: 1 }])
      }
      catch (error) {
        refused = error
      }
      expect(refused).toMatchObject({ statusCode: 400, code: 'age_limit_range_invalid', details: { row: 2 } })
      expect(listGroupAgeLimits(db, 1, bears)).toEqual([{ fromYears: 0, toYears: 3, maxChildren: 5 }])
    })

    it('refuses a group of another facility', () => {
      const other = createFacility(db, 'Hort', 'BY').id
      const foxes = addGroup(db, other, 'Füchse')
      expect(() => setGroupAgeLimits(db, 1, foxes, [])).toThrow('group_not_found')
      expect(() => listGroupAgeLimits(db, 1, foxes)).toThrow('group_not_found')
    })

    it('go along when the group is deleted', () => {
      setGroupAgeLimits(db, 1, mice, [{ fromYears: 0, toYears: 3, maxChildren: 5 }])
      deleteGroup(db, 1, mice, TODAY)
      expect(db.select().from(groupAgeLimits).all()).toEqual([])
    })
  })

  describe('the Belegung', () => {
    it('marks the cells where a rule of the group is exceeded, with the rule and the count', () => {
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 1 }, { fromYears: 3, toYears: 6, maxChildren: 5 }])
      addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2025-01-10' })
      // Turns 3 on 2027-03-01: from March on it no longer counts under 3.
      addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2024-03-01' })
      addChild(db, 1, { groupId: mice, entryDate: '2026-01-01', birthDate: '2025-01-10' })
      const table = occupancyTable(db, 1, 2026)
      const row = table.rows.find(entry => entry.groupId === bears)!
      // September 2026 to August 2027: over until February.
      expect(row.cells.map(cell => cell.ageViolations.length)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
      expect(row.cells[0]!.ageViolations).toEqual([{ fromYears: 0, toYears: 3, maxChildren: 1, count: 2 }])
      expect(table.rows.find(entry => entry.groupId === mice)!.cells.every(cell => cell.ageViolations.length === 0)).toBe(true)
      expect(table.total.cells.every(cell => cell.ageViolations.length === 0)).toBe(true)
    })
  })

  describe('the hint on the Kinder page', () => {
    it('names the first month of each group and rule over in the coming twelve months', () => {
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 1 }])
      setGroupAgeLimits(db, 1, mice, [{ fromYears: 2, toYears: 3, maxChildren: 0 }])
      addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2025-01-10' })
      // A future contract takes Bären over from March 2027.
      addChild(db, 1, { groupId: bears, entryDate: '2027-03-15', birthDate: '2025-02-10' })
      // Turns 2 on 2027-06-01 in Mäuse.
      addChild(db, 1, { groupId: mice, entryDate: '2026-01-01', birthDate: '2025-06-01' })
      // Later than twelve months: not named.
      addChild(db, 1, { groupId: bears, entryDate: '2028-01-01', birthDate: '2026-01-01' })
      expect(upcomingAgeLimitWarnings(db, 1, TODAY)).toEqual([
        { groupId: bears, groupName: 'Bären', fromYears: 0, toYears: 3, maxChildren: 1, count: 2, year: 2027, month: 3 },
        { groupId: mice, groupName: 'Mäuse', fromYears: 2, toYears: 3, maxChildren: 0, count: 1, year: 2027, month: 6 },
      ])
    })

    it('is empty without rules or when every rule holds', () => {
      addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2025-01-10' })
      expect(upcomingAgeLimitWarnings(db, 1, TODAY)).toEqual([])
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 1 }])
      expect(upcomingAgeLimitWarnings(db, 1, TODAY)).toEqual([])
    })
  })

  describe('the warning after a save', () => {
    beforeEach(() => {
      setGroupAgeLimits(db, 1, bears, [{ fromYears: 0, toYears: 3, maxChildren: 1 }])
      addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2025-01-10' })
    })

    function saving(childId: number | null, save: () => number | void, viewer: { permissions: ChildActor['permissions'] } = admin) {
      const before = ageLimitCells(db, 1, childId, TODAY)
      const id = save() ?? childId!
      return ageLimitWarnings(db, viewer, 1, id, before, TODAY)
    }

    it('warns when a new child takes a group over a rule, and the child is saved anyway', () => {
      let id = 0
      expect(saving(null, () => (id = createChild(db, admin, 1, master({ groupId: bears }), NOW)))).toEqual([
        { groupId: bears, groupName: 'Bären', fromYears: 0, toYears: 3, maxChildren: 1, count: 2, year: 2026, month: 12 },
      ])
      expect(id).toBeGreaterThan(0)
    })

    it('warns for a group change in the master data and for a planned group change', () => {
      const anna = addChild(db, 1, { groupId: mice, entryDate: '2026-01-01', birthDate: '2025-03-10' })
      expect(saving(anna, () => updateChildMaster(db, admin, 1, anna, {
        ...master({ groupId: bears, firstName: 'Anna', birthDate: '2025-03-10', entryDate: '2026-01-01' }), baseGroupId: mice,
      }, TODAY, NOW))).toEqual([
        { groupId: bears, groupName: 'Bären', fromYears: 0, toYears: 3, maxChildren: 1, count: 2, year: 2026, month: 11 },
      ])
      const ben = addChild(db, 1, { groupId: mice, entryDate: '2026-01-01', birthDate: '2025-04-10' })
      expect(saving(ben, () => planGroupChange(db, admin, 1, ben, { groupId: bears, date: '2027-02-01', keep: KEEP_ALL }, TODAY, NOW)))
        .toEqual([{ groupId: bears, groupName: 'Bären', fromYears: 0, toYears: 3, maxChildren: 1, count: 3, year: 2027, month: 2 }])
    })

    it('does not warn for a child outside the rule\'s ages, a save that adds nothing, or someone without children.manage', () => {
      expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears, birthDate: '2021-05-10' }), NOW))).toEqual([])
      const anna = addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2025-03-10' })
      expect(saving(anna, () => updateChildMaster(db, admin, 1, anna, {
        ...master({ groupId: bears, firstName: 'Anna', birthDate: '2025-03-10', entryDate: '2026-01-01', note: 'x' }), baseGroupId: bears,
      }, TODAY, NOW))).toEqual([])
      expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears, firstName: 'Ole' }), NOW), { permissions: permissionsOf('observer') }))
        .toEqual([])
    })

    it('warns when a later leaving day lengthens the stay into months over a rule', () => {
      const anna = addChild(db, 1, { groupId: bears, entryDate: '2026-01-01', birthDate: '2025-03-10', leftOn: '2026-11-30' })
      expect(saving(anna, () => leaveChild(db, 1, anna, '2027-02-28', TODAY))).toEqual([
        { groupId: bears, groupName: 'Bären', fromYears: 0, toYears: 3, maxChildren: 1, count: 2, year: 2026, month: 12 },
      ])
      // An earlier day again takes months away: nothing to warn.
      expect(saving(anna, () => leaveChild(db, 1, anna, '2026-12-31', TODAY))).toEqual([])
    })

    it('only looks at the coming twelve months', () => {
      expect(saving(null, () => createChild(db, admin, 1, master({ groupId: bears, entryDate: '2027-12-01', birthDate: '2026-05-10' }), NOW)))
        .toEqual([])
    })
  })
})
