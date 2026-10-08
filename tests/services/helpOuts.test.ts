import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, entries, helpOuts } from '../../server/db/schema'
import { moveEmployeeToFacility } from '../../server/services/employees'
import { addHelpOut, helpCandidates, isHelperOn, listHelpers, removeHelpOut } from '../../server/services/helpOuts'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries, ownCellFilter } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut as addHelpOutRow, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-28'

describe('help-outs', () => {
  let db: Db
  let krippe: number
  let hort: number
  let anna: number
  let kim: number
  let zoe: number
  let lena: number

  /** Writes an entry straight into the table (the cell rules come with Task 2). */
  function insertEntry(employeeId: number, date: string, helpFacilityId: number | null, facilityId = 1) {
    return db.insert(entries).values({
      employeeId, date, kind: 'shift', shiftTemplateId: templateId(db, 'F1', facilityId), start: 420, end: 795,
      helpFacilityId, updatedAt: 'now',
    }).returning().get().id
  }

  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    hort = addFacility(db, 'Hort')
    anna = addEmployee(db, 'Anna')
    lena = addEmployee(db, 'Lena')
    kim = addEmployee(db, 'Kim', { facilityId: krippe })
    zoe = addEmployee(db, 'Zoe', { facilityId: hort })
  })

  describe('adding and listing', () => {
    it('adds a helper of another facility for one month and lists them by name', () => {
      const lenaRow = addHelpOut(db, krippe, { employeeId: lena, year: 2026, month: 11 })
      const annaRow = addHelpOut(db, krippe, { employeeId: anna, year: 2026, month: 11 })
      addHelpOut(db, krippe, { employeeId: zoe, year: 2026, month: 12 })
      expect(listHelpers(db, krippe, 2026, 11)).toEqual([
        { helpOutId: annaRow, employeeId: anna, name: 'Anna', shortName: 'An', fromFacilityId: 1, fromFacility: 'Kindergarten' },
        { helpOutId: lenaRow, employeeId: lena, name: 'Lena', shortName: 'Le', fromFacilityId: 1, fromFacility: 'Kindergarten' },
      ])
      expect(listHelpers(db, krippe, 2026, 12).map(helper => [helper.name, helper.fromFacility])).toEqual([['Zoe', 'Hort']])
      expect(listHelpers(db, krippe, 2026, 10)).toEqual([])
      expect(listHelpers(db, 1, 2026, 11)).toEqual([])
    })

    it('refuses the facility\'s own staff and unknown ids', () => {
      expect(errorCode(() => addHelpOut(db, krippe, { employeeId: kim, year: 2026, month: 11 }))).toBe('employee_not_found')
      expect(errorCode(() => addHelpOut(db, krippe, { employeeId: 9999, year: 2026, month: 11 }))).toBe('employee_not_found')
      expect(db.select().from(helpOuts).all()).toEqual([])
    })

    it('refuses someone who is not employed in that month', () => {
      const gone = addEmployee(db, 'Gerd', { leftOn: '2026-10-31' })
      expect(errorCode(() => addHelpOut(db, krippe, { employeeId: gone, year: 2026, month: 11 }))).toBe('employee_not_found')
      expect(addHelpOut(db, krippe, { employeeId: gone, year: 2026, month: 10 })).toBeGreaterThan(0)
    })

    it('refuses the same helper twice in a month', () => {
      addHelpOut(db, krippe, { employeeId: anna, year: 2026, month: 11 })
      expect(errorCode(() => addHelpOut(db, krippe, { employeeId: anna, year: 2026, month: 11 }))).toBe('help_out_exists')
      // Another month, or another facility, is a separate row.
      addHelpOut(db, krippe, { employeeId: anna, year: 2026, month: 12 })
      addHelpOut(db, hort, { employeeId: anna, year: 2026, month: 11 })
      expect(db.select().from(helpOuts).all()).toHaveLength(3)
    })

    it('tells whether someone is a helper on a date', () => {
      addHelpOutRow(db, anna, krippe, 2026, 11)
      expect(isHelperOn(db, krippe, anna, '2026-11-01')).toBe(true)
      expect(isHelperOn(db, krippe, anna, '2026-11-30')).toBe(true)
      expect(isHelperOn(db, krippe, anna, '2026-10-31')).toBe(false)
      expect(isHelperOn(db, krippe, anna, '2026-12-01')).toBe(false)
      expect(isHelperOn(db, hort, anna, '2026-11-10')).toBe(false)
      expect(isHelperOn(db, krippe, lena, '2026-11-10')).toBe(false)
    })
  })

  describe('candidates', () => {
    it('lists the employed staff of the other facilities who are not yet helpers that month', () => {
      addEmployee(db, 'Gerd', { leftOn: '2026-10-31' })
      addEmployee(db, 'Nina', { facilityId: hort, validFrom: '2026-12-01' })
      addHelpOutRow(db, lena, krippe, 2026, 11)
      expect(helpCandidates(db, krippe, 2026, 11)).toEqual([
        { employeeId: anna, name: 'Anna', shortName: 'An', facilityName: 'Kindergarten' },
        { employeeId: zoe, name: 'Zoe', shortName: 'Zo', facilityName: 'Hort' },
      ])
      expect(helpCandidates(db, krippe, 2026, 12).map(candidate => candidate.name)).toEqual(['Anna', 'Lena', 'Nina', 'Zoe'])
      expect(helpCandidates(db, 1, 2026, 11).map(candidate => candidate.name)).toEqual(['Kim', 'Zoe'])
    })
  })

  describe('removing', () => {
    it('removes an empty helper column', () => {
      const id = addHelpOutRow(db, anna, krippe, 2026, 11)
      // Entries elsewhere (at home, in another month) do not keep the column.
      insertEntry(anna, '2026-11-03', null)
      insertEntry(anna, '2026-12-03', krippe, krippe)
      removeHelpOut(db, krippe, id)
      expect(listHelpers(db, krippe, 2026, 11)).toEqual([])
    })

    it('refuses while the helper still has entries in the facility that month', () => {
      const id = addHelpOutRow(db, anna, krippe, 2026, 11)
      const entry = insertEntry(anna, '2026-11-03', krippe, krippe)
      expect(errorCode(() => removeHelpOut(db, krippe, id))).toBe('help_out_has_entries')
      db.delete(entries).where(eq(entries.id, entry)).run()
      removeHelpOut(db, krippe, id)
      expect(db.select().from(helpOuts).all()).toEqual([])
    })

    it('answers another facility\'s row and unknown ids as not found', () => {
      const id = addHelpOutRow(db, anna, krippe, 2026, 11)
      expect(errorCode(() => removeHelpOut(db, hort, id))).toBe('help_out_not_found')
      expect(errorCode(() => removeHelpOut(db, 1, id))).toBe('help_out_not_found')
      expect(errorCode(() => removeHelpOut(db, krippe, 9999))).toBe('help_out_not_found')
      expect(db.select().from(helpOuts).all()).toHaveLength(1)
    })

    it('is removed with the employee', () => {
      addHelpOutRow(db, anna, krippe, 2026, 11)
      db.delete(employees).where(eq(employees.id, anna)).run()
      expect(db.select().from(helpOuts).all()).toEqual([])
    })
  })

  describe('reading entries', () => {
    it('returns helpFacilityId and splits the facility filter into home and plan', () => {
      const home = insertEntry(anna, '2026-11-02', null)
      const helping = insertEntry(anna, '2026-11-03', krippe, krippe)
      const kims = insertEntry(kim, '2026-11-03', null, krippe)
      const ids = (filter: Parameters<typeof loadEntries>[1]) => loadEntries(db, filter).map(entry => entry.id)
      expect(loadEntries(db, { employeeId: anna }).map(entry => entry.helpFacilityId)).toEqual([null, krippe])
      expect(ids({ homeFacilityId: 1 })).toEqual([home, helping])
      expect(ids({ homeFacilityId: krippe })).toEqual([kims])
      expect(ids({ planFacilityId: 1 })).toEqual([home])
      expect(ids({ planFacilityId: krippe })).toEqual([helping, kims])
      expect(ids({ planFacilityId: hort })).toEqual([])
    })

    it('counts a helper\'s cells as the facility\'s own only in their help-out months', () => {
      addHelpOutRow(db, anna, krippe, 2026, 11)
      const ownsInKrippe = ownCellFilter(db, krippe)
      expect(ownsInKrippe(kim, '2026-11-03')).toBe(true)
      expect(ownsInKrippe(anna, '2026-11-03')).toBe(true)
      expect(ownsInKrippe(anna, '2026-12-01')).toBe(false)
      expect(ownsInKrippe(lena, '2026-11-03')).toBe(false)
      expect(ownCellFilter(db, hort)(anna, '2026-11-03')).toBe(false)
      expect(ownCellFilter(db, 1)(anna, '2026-11-03')).toBe(true)
    })
  })

  describe('moving a helper into the facility they help in', () => {
    let provider: SessionUser
    beforeEach(() => {
      provider = addUser(db, 'traeger', 'provider')
    })

    it('turns their help-out entries there into home entries and drops their help-out rows there', () => {
      addHelpOutRow(db, anna, krippe, 2026, 11)
      addHelpOutRow(db, anna, krippe, 2026, 12)
      const hortRow = addHelpOutRow(db, anna, hort, 2026, 11)
      const home = insertEntry(anna, '2026-11-02', null)
      const inKrippe = insertEntry(anna, '2026-11-03', krippe, krippe)
      const inKrippeLater = insertEntry(anna, '2026-12-03', krippe, krippe)
      const inHort = insertEntry(anna, '2026-11-04', hort, hort)

      moveEmployeeToFacility(db, provider, anna, krippe, new Date(`${today}T08:00:00Z`))

      expect(loadEntries(db, { employeeId: anna }).map(entry => [entry.id, entry.helpFacilityId])).toEqual([
        [home, null], [inKrippe, null], [inHort, hort], [inKrippeLater, null],
      ])
      expect(db.select({ id: helpOuts.id }).from(helpOuts).all()).toEqual([{ id: hortRow }])
      expect(listHelpers(db, krippe, 2026, 11)).toEqual([])
      // Anna is ordinary staff of the Krippe now; her entries belong to its plan.
      expect(loadEntries(db, { planFacilityId: krippe, employeeId: anna }).map(entry => entry.id))
        .toEqual([home, inKrippe, inKrippeLater])
      expect(loadEntries(db, { planFacilityId: 1, employeeId: anna })).toEqual([])
    })

    it('leaves nothing pending in the old home facility', () => {
      addHelpOutRow(db, anna, krippe, 2026, 11)
      insertEntry(anna, '2026-11-03', krippe, krippe)
      const leitungA = addUser(db, 'leitungA', 'admin')
      releaseMonth(db, leitungA, 1, 2026, 11, new Date('2026-10-20T08:00:00Z'))
      moveEmployeeToFacility(db, provider, anna, krippe, new Date(`${today}T08:00:00Z`))
      expect(getMonthPlan(db, leitungA, 1, 2026, 11, today).admin!.pendingChanges).toEqual({})
    })
  })
})
