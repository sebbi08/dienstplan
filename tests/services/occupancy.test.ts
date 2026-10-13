import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setGroupCapacity } from '../../server/services/groups'
import { occupancyTable } from '../../server/services/occupancy'
import { setSchoolCutoff } from '../../server/services/schoolChildren'
import { addChild, addFacility, addGroup, createTestDb, errorCode } from '../helpers/fixtures'

/** Month index in the table: 0 = September, 1 = October … 11 = August. */
const SEP = 0
const OCT = 1
const NOV = 2
const AUG = 11

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
    expect(ids(bearsRow!.cells[NOV]!.present).sort()).toEqual([early, late].sort())
    // Born 2024-01-01: six on 2030-01-01, school start 2030-09-01, last day 2030-08-31.
    expect(bearsRow!.cells[OCT]!.fresh[0]).toEqual({ id: late, name: 'Ben B', from: '2026-10-15', to: '2030-08-31' })
    expect(ids(miceRow!.cells[SEP]!.fresh)).toEqual([other])
    expect(ids(table.total.cells[SEP]!.fresh).sort()).toEqual([early, other].sort())
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
    expect(row).toMatchObject({ name: 'ohne Gruppe', capacity: null })
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
  })

  it('refuses years outside 2000 to 2100', () => {
    expect(errorCode(() => occupancyTable(db, 1, 1999))).toBe('invalid_year')
    expect(errorCode(() => occupancyTable(db, 1, 2101))).toBe('invalid_year')
    expect(errorCode(() => occupancyTable(db, 1, 2026.5))).toBe('invalid_year')
    expect(errorCode(() => occupancyTable(db, 1, 2000))).toBeNull()
    expect(errorCode(() => occupancyTable(db, 1, 2100))).toBeNull()
  })
})
