import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges } from '../../server/db/schema'
import { applyDueGroupChanges, planGroupChange } from '../../server/services/childGroupChanges'
import { leaveChild, moveChildToFacility } from '../../server/services/children'
import { setGroupCapacity, setGroupForSchoolChildren } from '../../server/services/groups'
import { occupancyTable, upcomingSchoolChildren } from '../../server/services/occupancy'
import {
  leaveSchoolChildren, occupancyChildren, schoolLeavers, setAutoLeave, setSchoolCutoff,
} from '../../server/services/schoolChildren'
import type { FacilityUser } from '../../server/utils/auth'
import { addChild, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

/** Month index in the table: 0 = September, 1 = October … 11 = August. */
const SEP = 0
const OCT = 1
const NOV = 2
const FEB = 5
const MAR = 6
const APR = 7
const AUG = 11

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')
const KEEP_ALL = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }

describe('occupancy table', () => {
  let db: Db
  let bears: number
  let mice: number
  beforeEach(() => {
    db = createTestDb()
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    setGroupCapacity(db, 1, bears, 2)
  })

  const ids = (names: { id: number }[]) => names.map(name => name.id)

  it('lays out the Kita year with a row per group in the groups\' order and a total', () => {
    const table = occupancyTable(db, 1, 2026)
    expect(table.year).toBe(2026)
    expect(table.label).toBe('2026/27')
    expect(table.months[0]).toEqual({ year: 2026, month: 9 })
    expect(table.months[11]).toEqual({ year: 2027, month: 8 })
    expect(table.rows.map(row => [row.groupId, row.name, row.capacity])).toEqual([[bears, 'Bären', 2], [mice, 'Mäuse', null]])
    expect(table.rows.every(row => row.cells.length === 12)).toBe(true)
    expect(table.total.cells).toHaveLength(12)
    expect(table.total.capacity).toBeNull()
    expect(table.undated).toEqual([])
  })

  it('counts children per month, fresh ones in the bracket, with the borders of their stay', () => {
    const early = addChild(db, 1, { firstName: 'Anna', lastName: 'A', entryDate: '2026-09-01', groupId: bears, birthDate: '2024-01-01' })
    const late = addChild(db, 1, { firstName: 'Ben', lastName: 'B', entryDate: '2026-10-15', groupId: bears, birthDate: '2024-01-01' })
    const other = addChild(db, 1, { firstName: 'Cleo', lastName: 'C', entryDate: '2026-09-10', groupId: mice, birthDate: '2024-01-01' })

    const table = occupancyTable(db, 1, 2026)
    const [bearsRow, miceRow] = table.rows

    expect(ids(bearsRow!.cells[SEP]!.fresh)).toEqual([early])
    expect(bearsRow!.cells[SEP]!.present).toEqual([])
    expect(ids(bearsRow!.cells[OCT]!.present)).toEqual([early])
    expect(ids(bearsRow!.cells[OCT]!.fresh)).toEqual([late])
    expect(bearsRow!.cells[NOV]!.fresh).toEqual([])
    // In the order last name, first name.
    expect(ids(bearsRow!.cells[NOV]!.present)).toEqual([early, late])
    // Born 2024-01-01: six on 2030-01-01, school start 2030-09-01, last day 2030-08-31.
    expect(bearsRow!.cells[OCT]!.fresh[0]).toEqual({ id: late, name: 'Ben B', from: '2026-10-15', to: '2030-08-31' })
    expect(ids(miceRow!.cells[SEP]!.fresh)).toEqual([other])
    expect(ids(table.total.cells[SEP]!.fresh)).toEqual([early, other])
    expect(table.total.cells[NOV]!.present).toHaveLength(3)
  })

  it('does not count waitlist children and lists contract children without a start as undated', () => {
    addChild(db, 1, { groupId: bears, admissionStatus: 'waitlist', entryDate: null, plannedEntryDate: '2026-09-01' })
    const undated = addChild(db, 1, { firstName: 'Mia', lastName: 'Weber', groupId: bears, entryDate: null, plannedEntryDate: null })

    const table = occupancyTable(db, 1, 2026)

    expect(table.rows[0]!.cells.every(cell => cell.present.length === 0 && cell.fresh.length === 0)).toBe(true)
    expect(table.total.cells.every(cell => cell.present.length === 0 && cell.fresh.length === 0)).toBe(true)
    expect(table.undated).toEqual([{ id: undated, name: 'Mia Weber' }])
  })

  it('lists children whose stay ends before it starts as inconsistent, counts them nowhere and does not crash', () => {
    // Already of school age at the contract start: the school start lies before the entry.
    const tooOld = addChild(db, 1, { firstName: 'Max', lastName: 'Zander', groupId: bears, birthDate: '2015-01-01', entryDate: '2026-09-01' })
    // Left before the entry.
    const leftEarly = addChild(db, 1, {
      firstName: 'Ida', lastName: 'Adler', groupId: mice, birthDate: '2024-01-01', entryDate: '2026-10-01', leftOn: '2026-09-15',
    })
    // Left before the planned start, no group.
    const leftPlanned = addChild(db, 1, {
      firstName: 'Tim', lastName: 'Mohr', entryDate: null, plannedEntryDate: '2026-11-01', birthDate: '2024-01-01', leftOn: '2026-10-01',
    })
    // Leaving on the first day is a one-day stay, not inconsistent.
    const oneDay = addChild(db, 1, { firstName: 'Eva', lastName: 'Klein', groupId: mice, birthDate: '2024-01-01', entryDate: '2026-10-01', leftOn: '2026-10-01' })

    const table = occupancyTable(db, 1, 2026)

    expect(table.inconsistent).toEqual([
      { id: leftEarly, name: 'Ida Adler' }, { id: leftPlanned, name: 'Tim Mohr' }, { id: tooOld, name: 'Max Zander' },
    ])
    expect(table.undated).toEqual([])
    const counted = table.rows.flatMap(row => row.cells).concat(table.total.cells).flatMap(cell => [...cell.present, ...cell.fresh])
    expect(new Set(counted.map(name => name.id))).toEqual(new Set([oneDay]))
    expect(table.rows.map(row => row.groupId)).toEqual([bears, mice])
    expect(occupancyTable(db, 1, 2025).inconsistent).toHaveLength(3)
  })

  it('counts a contract child by its planned start when there is no entry date', () => {
    const id = addChild(db, 1, { groupId: bears, entryDate: null, plannedEntryDate: '2026-11-01', birthDate: '2024-01-01' })
    const cells = occupancyTable(db, 1, 2026).rows[0]!.cells
    expect(cells[OCT]!.fresh).toEqual([])
    expect(ids(cells[NOV]!.fresh)).toEqual([id])
  })

  it('counts a child born on the cutoff through August of its school start year, not September', () => {
    const id = addChild(db, 1, { groupId: bears, birthDate: '2021-06-30', entryDate: '2025-09-01' })
    expect(ids(occupancyTable(db, 1, 2026).rows[0]!.cells[AUG]!.present)).toEqual([id])
    expect(occupancyTable(db, 1, 2026).rows[0]!.cells[AUG]!.present[0]).toMatchObject({ to: '2027-08-31' })
    const next = occupancyTable(db, 1, 2027).rows[0]!.cells
    expect(next[SEP]!.present).toEqual([])
    expect(next[SEP]!.fresh).toEqual([])
  })

  it('counts a child born one day after the cutoff for another year', () => {
    const id = addChild(db, 1, { groupId: bears, birthDate: '2021-07-01', entryDate: '2025-09-01' })
    expect(ids(occupancyTable(db, 1, 2027).rows[0]!.cells[SEP]!.present)).toEqual([id])
    expect(occupancyTable(db, 1, 2028).rows[0]!.cells[SEP]!.present).toEqual([])
  })

  it('lets a later manual school start extend the stay', () => {
    const id = addChild(db, 1, { groupId: bears, birthDate: '2021-06-30', entryDate: '2025-09-01', schoolStartDate: '2028-09-01' })
    expect(ids(occupancyTable(db, 1, 2027).rows[0]!.cells[SEP]!.present)).toEqual([id])
    expect(occupancyTable(db, 1, 2027).rows[0]!.cells[AUG]!.present[0]).toMatchObject({ to: '2028-08-31' })
    expect(occupancyTable(db, 1, 2028).rows[0]!.cells[SEP]!.present).toEqual([])
  })

  it('follows the facility\'s cutoff', () => {
    const id = addChild(db, 1, { groupId: bears, birthDate: '2021-07-01', entryDate: '2025-09-01' })
    setSchoolCutoff(db, 1, { cutoffMonth: 7, cutoffDay: 1, ageYears: 6 })
    expect(occupancyTable(db, 1, 2027).rows[0]!.cells[SEP]!.present).toEqual([])
    expect(ids(occupancyTable(db, 1, 2026).rows[0]!.cells[AUG]!.present)).toEqual([id])
  })

  it('counts a child who left until the month of leaving, archived children included', () => {
    const id = addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', leftOn: '2026-12-15', birthDate: '2024-01-01' })
    const cells = occupancyTable(db, 1, 2026).rows[0]!.cells
    expect(ids(cells[3]!.present)).toEqual([id]) // December
    expect(cells[4]!.present).toEqual([]) // January
  })

  it('turns red from reaching the capacity on and reports how many children are above it', () => {
    addChild(db, 1, { groupId: bears, entryDate: '2026-09-01', birthDate: '2024-01-01' })
    expect(occupancyTable(db, 1, 2026).rows[0]!.cells[SEP]).toMatchObject({ red: false, over: 0 })
    addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: '2024-01-01' })
    expect(occupancyTable(db, 1, 2026).rows[0]!.cells[SEP]).toMatchObject({ red: true, over: 0 })
    setGroupCapacity(db, 1, bears, 1)
    // Capacity 1 with two children: present plus fresh counts.
    expect(occupancyTable(db, 1, 2026).rows[0]!.cells[SEP]).toMatchObject({ red: true, over: 1 })
    expect(occupancyTable(db, 1, 2026).rows[0]!.capacity).toBe(1)
  })

  it('never turns red for a group without capacity', () => {
    addChild(db, 1, { groupId: mice, entryDate: '2026-09-01', birthDate: '2024-01-01' })
    expect(occupancyTable(db, 1, 2026).rows[1]!.cells[SEP]).toMatchObject({ red: false, over: 0 })
  })

  it('shows the row without group only when a cell is filled, and never red', () => {
    expect(occupancyTable(db, 1, 2026).rows.map(row => row.groupId)).toEqual([bears, mice])
    const id = addChild(db, 1, { groupId: null, entryDate: '2026-10-01', birthDate: '2024-01-01' })
    const table = occupancyTable(db, 1, 2026)
    expect(table.rows.map(row => row.groupId)).toEqual([bears, mice, null])
    const row = table.rows[2]!
    // The client labels this row, the server sends no German text.
    expect(row).toMatchObject({ name: '', capacity: null })
    expect(ids(row.cells[OCT]!.fresh)).toEqual([id])
    expect(row.cells.every(cell => !cell.red)).toBe(true)
    // A year the child is not part of: no row.
    expect(occupancyTable(db, 1, 2000).rows.map(r => r.groupId)).toEqual([bears, mice])
  })

  it('counts a child once in the total and is red only when every group has a capacity', () => {
    setGroupCapacity(db, 1, bears, 1)
    addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: '2024-01-01' })
    addChild(db, 1, { groupId: mice, entryDate: '2025-09-01', birthDate: '2024-01-01' })
    const noMiceCapacity = occupancyTable(db, 1, 2026)
    expect(noMiceCapacity.total.capacity).toBeNull()
    expect(noMiceCapacity.total.cells[SEP]!.present).toHaveLength(2)
    expect(noMiceCapacity.total.cells[SEP]).toMatchObject({ red: false, over: 0 })

    setGroupCapacity(db, 1, mice, 3)
    const complete = occupancyTable(db, 1, 2026)
    expect(complete.total.capacity).toBe(4)
    expect(complete.total.cells[SEP]).toMatchObject({ red: false, over: 0 })
    addChild(db, 1, { groupId: mice, entryDate: '2025-09-01', birthDate: '2024-01-01' })
    addChild(db, 1, { groupId: bears, entryDate: '2026-09-01', birthDate: '2024-01-01' })
    const full = occupancyTable(db, 1, 2026).total.cells[SEP]!
    expect(full).toMatchObject({ red: true, over: 0 })
    expect(full.present).toHaveLength(3)
    expect(full.fresh).toHaveLength(1)
  })

  it('has no total capacity without groups', () => {
    const empty = addFacility(db, 'Krippe')
    const table = occupancyTable(db, empty, 2026)
    expect(table.rows).toEqual([])
    expect(table.total.capacity).toBeNull()
    expect(table.total.cells.every(cell => !cell.red)).toBe(true)
  })

  it('ignores the children and groups of other facilities', () => {
    const krippe = addFacility(db, 'Krippe')
    const krippeGroup = addGroup(db, krippe, 'Wichtel')
    addChild(db, krippe, { groupId: krippeGroup, entryDate: '2026-09-01', birthDate: '2024-01-01' })
    addChild(db, krippe, { entryDate: null, plannedEntryDate: null })
    const table = occupancyTable(db, 1, 2026)
    expect(table.rows.map(row => row.groupId)).toEqual([bears, mice])
    expect(table.total.cells.every(cell => cell.present.length === 0 && cell.fresh.length === 0)).toBe(true)
    expect(table.undated).toEqual([])
    expect(table.inconsistent).toEqual([])
  })

  describe('group history', () => {
    let admin: FacilityUser
    beforeEach(() => {
      admin = addUser(db, 'leitung', 'admin') as FacilityUser
    })

    it('counts a child with a planned mid-month change in the old group (present) and in the new one (fresh), once in the total', () => {
      const id = addChild(db, 1, { firstName: 'Anna', lastName: 'A', groupId: bears, entryDate: '2025-09-01', birthDate: '2024-01-01' })
      planGroupChange(db, admin, 1, id, { groupId: mice, date: '2027-03-15', keep: KEEP_ALL }, TODAY, NOW)

      const check = () => {
        const table = occupancyTable(db, 1, 2026)
        const [bearsRow, miceRow] = table.rows
        expect(bearsRow!.cells[MAR]!.present).toEqual([{ id, name: 'Anna A', from: '2025-09-01', to: '2027-03-14' }])
        expect(bearsRow!.cells[MAR]!.fresh).toEqual([])
        expect(bearsRow!.cells[APR]).toMatchObject({ present: [], fresh: [] })
        expect(miceRow!.cells[FEB]).toMatchObject({ present: [], fresh: [] })
        expect(miceRow!.cells[MAR]!.fresh).toEqual([{ id, name: 'Anna A', from: '2027-03-15', to: '2030-08-31' }])
        expect(miceRow!.cells[MAR]!.present).toEqual([])
        expect(ids(miceRow!.cells[APR]!.present)).toEqual([id])
        expect(miceRow!.cells[APR]!.fresh).toEqual([])
        // A group change is not a new child of the facility.
        expect(ids(table.total.cells[MAR]!.present)).toEqual([id])
        expect(table.total.cells[MAR]!.fresh).toEqual([])
        expect(ids(table.total.cells[APR]!.present)).toEqual([id])
      }
      check()
      // Applying the change on its day does not change the numbers.
      expect(applyDueGroupChanges(db, '2027-03-15')).toBe(1)
      check()
    })

    it('counts a past change from its day on, not with today\'s group for every month', () => {
      const id = addChild(db, 1, { groupId: bears, entryDate: '2025-09-01', birthDate: '2024-01-01' })
      planGroupChange(db, admin, 1, id, { groupId: mice, date: '2026-10-01', keep: KEEP_ALL }, TODAY, NOW)

      const [bearsRow, miceRow] = occupancyTable(db, 1, 2026).rows
      expect(ids(bearsRow!.cells[SEP]!.present)).toEqual([id])
      expect(bearsRow!.cells[OCT]).toMatchObject({ present: [], fresh: [] })
      expect(miceRow!.cells[SEP]).toMatchObject({ present: [], fresh: [] })
      expect(ids(miceRow!.cells[OCT]!.fresh)).toEqual([id])
      expect(ids(miceRow!.cells[NOV]!.present)).toEqual([id])
    })

    it('passes the history to the counting rule ordered by day (start entry first), whatever the order of the rows', () => {
      const id = addChild(db, 1, { groupId: bears })
      const other = addChild(db, 1, { lastName: 'Zander', groupId: mice })
      const entry = { childId: id, createdAt: NOW.toISOString(), appliedAt: NOW.toISOString() }
      db.insert(childGroupChanges).values({ ...entry, groupId: mice, fromDate: '2027-05-01' }).run()
      db.insert(childGroupChanges).values({ ...entry, groupId: null, fromDate: '2026-12-01' }).run()
      db.insert(childGroupChanges).values({ ...entry, groupId: bears, fromDate: '2027-01-01', appliedAt: null }).run()

      const result = occupancyChildren(db, 1).children
      expect(result.find(child => child.id === id)!.groups).toEqual([
        { from: null, groupId: bears }, { from: '2026-12-01', groupId: null }, { from: '2027-01-01', groupId: bears },
        { from: '2027-05-01', groupId: mice },
      ])
      expect(result.find(child => child.id === other)!.groups).toEqual([{ from: null, groupId: mice }])
    })

    it('counts the time in a group of another facility as without group', () => {
      const krippe = addFacility(db, 'Krippe')
      const wichtel = addGroup(db, krippe, 'Wichtel')
      const id = addChild(db, krippe, { groupId: wichtel, entryDate: '2026-09-01', birthDate: '2024-01-01' })
      moveChildToFacility(db, id, 1, NOW)

      const table = occupancyTable(db, 1, 2026)
      expect(table.rows.map(row => row.groupId)).toEqual([bears, mice, null])
      expect(ids(table.rows[2]!.cells[SEP]!.fresh)).toEqual([id])
      expect(table.rows[2]!.cells[OCT]!.present).toEqual([{ id, name: 'Kind Muster', from: '2026-09-01', to: '2030-08-31' }])
      expect(ids(table.total.cells[OCT]!.present)).toEqual([id])
    })
  })

  describe('groups for school children', () => {
    let admin: FacilityUser
    let hort: number
    beforeEach(() => {
      admin = addUser(db, 'leitung', 'admin') as FacilityUser
      hort = addGroup(db, 1, 'Hort')
      setGroupForSchoolChildren(db, hort, true)
    })

    it('counts a child that changes into such a group on its school start there from September on, with an open end', () => {
      const id = addChild(db, 1, { firstName: 'Anna', lastName: 'A', groupId: bears, birthDate: '2021-06-30', entryDate: '2025-09-01' })
      planGroupChange(db, admin, 1, id, { groupId: hort, date: '2027-09-01', keep: KEEP_ALL, newContract: true }, TODAY, NOW)

      expect(occupancyTable(db, 1, 2026).rows[0]!.cells[AUG]!.present).toEqual([{ id, name: 'Anna A', from: '2025-09-01', to: '2027-08-31' }])
      const table = occupancyTable(db, 1, 2027)
      const [bearsRow, , hortRow] = table.rows
      expect(bearsRow!.cells[SEP]).toMatchObject({ present: [], fresh: [] })
      expect(hortRow!.cells[SEP]!.fresh).toEqual([{ id, name: 'Anna A', from: '2027-09-01', to: null }])
      expect(ids(hortRow!.cells[OCT]!.present)).toEqual([id])
      expect(ids(hortRow!.cells[AUG]!.present)).toEqual([id])
      // The change is not a new child of the facility.
      expect(ids(table.total.cells[SEP]!.present)).toEqual([id])
      expect(table.total.cells[SEP]!.fresh).toEqual([])
      expect(table.inconsistent).toEqual([])
      // Without a leaving day it stays for good.
      expect(ids(occupancyTable(db, 1, 2030).rows[2]!.cells[AUG]!.present)).toEqual([id])
    })

    it('keeps the stay open when the change into such a group only comes after the school start', () => {
      const id = addChild(db, 1, { firstName: 'Anna', lastName: 'A', groupId: bears, birthDate: '2021-06-30', entryDate: '2025-09-01' })
      planGroupChange(db, admin, 1, id, { groupId: hort, date: '2027-09-13', keep: KEEP_ALL, newContract: true }, TODAY, NOW)

      // Until the change the child counts in its old group, also in the first days of September.
      const table = occupancyTable(db, 1, 2027)
      const [bearsRow, , hortRow] = table.rows
      expect(bearsRow!.cells[SEP]!.present).toEqual([{ id, name: 'Anna A', from: '2025-09-01', to: '2027-09-12' }])
      expect(bearsRow!.cells[OCT]).toMatchObject({ present: [], fresh: [] })
      expect(hortRow!.cells[SEP]!.fresh).toEqual([{ id, name: 'Anna A', from: '2027-09-13', to: null }])
      expect(ids(hortRow!.cells[OCT]!.present)).toEqual([id])
      expect(ids(table.total.cells[SEP]!.present)).toEqual([id])
      expect(table.inconsistent).toEqual([])
    })

    it('ends the stay the day before the school start when the later change leads into another group', () => {
      const id = addChild(db, 1, { groupId: bears, birthDate: '2021-06-30', entryDate: '2025-09-01' })
      planGroupChange(db, admin, 1, id, { groupId: mice, date: '2027-09-13', keep: KEEP_ALL }, TODAY, NOW)

      expect(occupancyTable(db, 1, 2026).rows[0]!.cells[AUG]!.present[0]).toMatchObject({ id, to: '2027-08-31' })
      const table = occupancyTable(db, 1, 2027)
      expect(table.rows[1]!.cells[SEP]).toMatchObject({ present: [], fresh: [] })
      expect(table.total.cells[SEP]).toMatchObject({ present: [], fresh: [] })
    })

    it('counts a child that starts in such a group at school age, instead of listing it as inconsistent', () => {
      const id = addChild(db, 1, { groupId: hort, birthDate: '2019-01-01', entryDate: '2026-09-01' })
      const table = occupancyTable(db, 1, 2026)
      expect(table.inconsistent).toEqual([])
      expect(table.rows[2]!.cells[SEP]!.fresh).toEqual([{ id, name: 'Kind Muster', from: '2026-09-01', to: null }])
    })
  })

  describe('school children of the coming September', () => {
    let admin: FacilityUser
    let hort: number
    beforeEach(() => {
      admin = addUser(db, 'leitung', 'admin') as FacilityUser
      hort = addGroup(db, 1, 'Hort')
      setGroupForSchoolChildren(db, hort, true)
    })

    /** Born on the default cutoff: the school start is 1 September 2027. */
    const schoolChild = (overrides: Parameters<typeof addChild>[2] = {}) =>
      addChild(db, 1, { birthDate: '2021-06-30', groupId: bears, ...overrides })
    const listed = (today: string) => upcomingSchoolChildren(db, 1, today).map(child => child.id)
    /** Switches the automatic leaving on as the Träger does: confirming the children the preview shows that day. */
    const switchOn = (today = TODAY) => setAutoLeave(db, 1, true, today, schoolLeavers(db, 1, today).map(child => child.id))

    it('is empty before 1 March and lists the children of the coming 1 September from then on', () => {
      const id = schoolChild({ firstName: 'Lena', lastName: 'Meier' })
      schoolChild({ birthDate: '2021-07-01' })

      expect(upcomingSchoolChildren(db, 1, TODAY)).toEqual([])
      expect(upcomingSchoolChildren(db, 1, '2027-02-28')).toEqual([])
      const entry = { id, name: 'Lena Meier', groupId: bears, schoolStart: '2027-09-01', pendingSchoolGroup: null }
      expect(upcomingSchoolChildren(db, 1, '2027-03-01')).toEqual([entry])
      expect(upcomingSchoolChildren(db, 1, '2027-08-31')).toEqual([entry])
    })

    it('names the group for school children the child is in on its school start or changes into afterwards', () => {
      const changes = schoolChild({ firstName: 'Anna', lastName: 'A' })
      const later = schoolChild({ firstName: 'Ben', lastName: 'B' })
      const elsewhere = schoolChild({ firstName: 'Carl', lastName: 'C' })
      const laterElsewhere = schoolChild({ firstName: 'Dora', lastName: 'D' })
      planGroupChange(db, admin, 1, changes, { groupId: hort, date: '2027-09-01', keep: KEEP_ALL, newContract: true }, TODAY, NOW)
      planGroupChange(db, admin, 1, later, { groupId: hort, date: '2027-09-13', keep: KEEP_ALL, newContract: true }, TODAY, NOW)
      planGroupChange(db, admin, 1, elsewhere, { groupId: mice, date: '2027-09-01', keep: KEEP_ALL }, TODAY, NOW)
      planGroupChange(db, admin, 1, laterElsewhere, { groupId: mice, date: '2027-09-13', keep: KEEP_ALL }, TODAY, NOW)

      expect(upcomingSchoolChildren(db, 1, '2027-03-01')).toEqual([
        { id: changes, name: 'Anna A', groupId: bears, schoolStart: '2027-09-01', pendingSchoolGroup: 'Hort' },
        { id: later, name: 'Ben B', groupId: bears, schoolStart: '2027-09-01', pendingSchoolGroup: 'Hort' },
        { id: elsewhere, name: 'Carl C', groupId: bears, schoolStart: '2027-09-01', pendingSchoolGroup: null },
        { id: laterElsewhere, name: 'Dora D', groupId: bears, schoolStart: '2027-09-01', pendingSchoolGroup: null },
      ])
      // Exactly those without such a group are the ones the automatic leaving takes, and the only ones still listed then.
      expect(schoolLeavers(db, 1, '2027-09-01').map(child => child.id)).toEqual([elsewhere, laterElsewhere])
      expect(listed('2027-09-01')).toEqual([elsewhere, laterElsewhere])
    })

    it('keeps listing the children whose school start is reached until they are deregistered, whatever the month', () => {
      const id = schoolChild()
      const inHort = schoolChild({ groupId: hort })

      expect(listed('2027-08-31')).toEqual([id, inHort])
      // Reached: the child of the group for school children stays for good and needs nothing any more.
      expect(listed('2027-09-01')).toEqual([id])
      expect(listed('2028-01-15')).toEqual([id])
      expect(listed('2028-06-01')).toEqual([id])

      leaveChild(db, 1, id, '2028-05-31', '2028-06-01')
      expect(listed('2028-06-01')).toEqual([])
    })

    it('shows exactly the children the automatic leaving takes once their school start is reached', () => {
      switchOn()
      const id = schoolChild()
      expect(listed('2027-09-01')).toEqual([id])
      expect(schoolLeavers(db, 1, '2027-09-01').map(child => child.id)).toEqual([id])
      expect(leaveSchoolChildren(db, '2027-09-01')).toBe(1)
      expect(listed('2027-09-01')).toEqual([])
    })

    it('still lists the reached children the automatic leaving skips, so somebody decides about them', () => {
      // School start 1 September 2023; the leaving day 31 August 2023 is past the three years of retention.
      const expired = schoolChild({ firstName: 'Anna', birthDate: '2017-03-01', entryDate: '2022-09-01' })
      // School start 1 September 2026, but it only started afterwards.
      const startedLate = schoolChild({ firstName: 'Ben', birthDate: '2020-03-01', entryDate: '2026-10-01' })
      switchOn()

      expect(schoolLeavers(db, 1, TODAY)).toEqual([])
      expect(leaveSchoolChildren(db, TODAY)).toBe(0)
      expect(upcomingSchoolChildren(db, 1, TODAY)).toEqual([
        { id: expired, name: 'Anna Muster', groupId: bears, schoolStart: '2023-09-01', pendingSchoolGroup: null },
        { id: startedLate, name: 'Ben Muster', groupId: bears, schoolStart: '2026-09-01', pendingSchoolGroup: null },
      ])
    })

    it('orders by school start, then name, and follows a manual school start', () => {
      const zoe = schoolChild({ firstName: 'Zoe', lastName: 'Adler' })
      const ida = schoolChild({ firstName: 'Ida', lastName: 'Adler' })
      const early = schoolChild({ firstName: 'Max', lastName: 'Zander', schoolStartDate: '2027-08-16' })
      const brought = schoolChild({ firstName: 'Eva', lastName: 'Klein', birthDate: '2021-07-01', schoolStartDate: '2027-09-01' })
      schoolChild({ firstName: 'Tom', lastName: 'Berg', schoolStartDate: '2028-09-01' })

      expect(listed('2027-03-01')).toEqual([early, ida, zoe, brought])
    })

    it('leaves out Vormerkungen, children who have not started, children with a leaving day and other facilities', () => {
      const krippe = addFacility(db, 'Krippe')
      const id = schoolChild()
      schoolChild({ admissionStatus: 'waitlist', entryDate: null })
      schoolChild({ entryDate: '2027-10-01' })
      schoolChild({ entryDate: null, plannedEntryDate: '2026-01-01' })
      schoolChild({ leftOn: '2027-07-31' })
      schoolChild({ leftOn: '2027-12-31' })
      addChild(db, krippe, { birthDate: '2021-06-30' })

      expect(listed('2027-03-01')).toEqual([id])
      expect(listed('2027-09-01')).toEqual([id])
    })
  })

  it('refuses years outside 2000 to 2100', () => {
    expect(errorCode(() => occupancyTable(db, 1, 1999))).toBe('invalid_year')
    expect(errorCode(() => occupancyTable(db, 1, 2101))).toBe('invalid_year')
    expect(errorCode(() => occupancyTable(db, 1, 2026.5))).toBe('invalid_year')
    expect(errorCode(() => occupancyTable(db, 1, 2000))).toBeNull()
    expect(errorCode(() => occupancyTable(db, 1, 2100))).toBeNull()
  })
})
