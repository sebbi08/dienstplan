import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { entries, facilityHelpoutPairs } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells, setEntryGroup, updateEntryTimes } from '../../server/services/entries'
import { addHelpOut, helpCandidates, listHelpers } from '../../server/services/helpOuts'
import { helpOutAllowed, helpOutsBetween, listHelpoutPairs, setHelpoutPair } from '../../server/services/helpoutPairs'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import { unlockChildren } from '../../server/services/tabletUnlock'
import { setPin, terminalStatus } from '../../server/services/terminal'
import { cellKey } from '../../shared/domain/cells'
import type { SessionUser } from '../../shared/types/api'
import {
  addEmployee, addFacility, addGroup, addHelpOut as addHelpOutRow, addUser, createTestDb, errorCode, templateId,
} from '../helpers/fixtures'

const NOW = new Date('2026-11-24T08:00:00Z') // 09:00 Berlin
const TODAY = '2026-11-24'

/** The details of a refusal (the facility named in help_out_not_paired). */
function detailsOf(run: () => unknown): unknown {
  try {
    run()
    return null
  }
  catch (error) {
    return (error as { details?: unknown }).details
  }
}

/**
 * Aushilfe zwischen Einrichtungen only with the Träger's mutual permission (server/services/helpoutPairs.ts): the pairs,
 * every path that plans a help-out, and what a help-out lets the helper see.
 */
describe('help-outs between facilities need the Träger\'s pair', () => {
  let db: Db
  let krippe: number
  let hort: number
  let anna: number
  let traeger: SessionUser
  let leitung: SessionUser
  let leitungKrippe: SessionUser
  let leitungHort: SessionUser
  const shift = () => ({ kind: 'shift' as const, templateId: templateId(db, 'F1', krippe) })
  const plan = (mode: 'replace' | 'clear' = 'replace', date = TODAY) =>
    applyToCells(db, leitungKrippe, krippe, [{ employeeId: anna, date }], mode, mode === 'clear' ? null : shift(), { now: NOW })
  const helperEntry = () => loadEntries(db, { employeeId: anna }).find(entry => entry.helpFacilityId === krippe)!

  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    hort = addFacility(db, 'Hort')
    anna = addEmployee(db, 'Anna')
    traeger = addUser(db, 'traeger', 'provider', null, 1)
    leitung = addUser(db, 'leitung', 'admin', null, 1)
    leitungKrippe = addUser(db, 'leitungKrippe', 'admin', null, krippe)
    leitungHort = addUser(db, 'leitungHort', 'admin', null, hort)
  })

  it('starts without pairs; the Träger sets and ends them for both facilities at once, the Leitung sees her own', () => {
    expect(listHelpoutPairs(db, traeger)).toEqual({ pairs: [], names: {}, unpaired: [] })
    setHelpoutPair(db, traeger, krippe, 1, true)
    setHelpoutPair(db, traeger, 1, krippe, true)
    expect(db.select().from(facilityHelpoutPairs).all()).toEqual([{ facilityAId: 1, facilityBId: krippe }])
    expect(listHelpoutPairs(db, traeger)).toMatchObject({ pairs: [[1, krippe]], names: { 1: 'Kindergarten', [krippe]: 'Krippe' } })
    // Mutual: the Leitung of either facility sees the pair, a third facility none.
    expect(listHelpoutPairs(db, leitung).pairs).toEqual([[1, krippe]])
    expect(listHelpoutPairs(db, leitungKrippe)).toMatchObject({ pairs: [[1, krippe]], names: { 1: 'Kindergarten', [krippe]: 'Krippe' }, unpaired: [] })
    expect(listHelpoutPairs(db, leitungHort)).toEqual({ pairs: [], names: {}, unpaired: [] })
    expect([helpOutAllowed(db, 1, krippe), helpOutAllowed(db, krippe, 1), helpOutAllowed(db, 1, hort), helpOutAllowed(db, hort, hort)])
      .toEqual([true, true, false, true])
    // Only the Träger, two different existing facilities.
    expect(errorCode(() => setHelpoutPair(db, leitung, 1, hort, true))).toBe('forbidden')
    expect(errorCode(() => setHelpoutPair(db, traeger, 1, 1, true))).toBe('helpout_pair_invalid')
    expect(errorCode(() => setHelpoutPair(db, traeger, 1, 999, true))).toBe('facility_not_found')
    setHelpoutPair(db, traeger, krippe, 1, false)
    expect(listHelpoutPairs(db, traeger).pairs).toEqual([])
  })

  it('refuses a help-out between facilities without the pair on every path; with it, and within a facility, it works', () => {
    // The helper column: not offered, and refused naming the helper's home facility.
    expect(helpCandidates(db, krippe, 2026, 11)).toEqual([])
    expect(errorCode(() => addHelpOut(db, krippe, { employeeId: anna, year: 2026, month: 11 }))).toBe('help_out_not_paired')
    expect(detailsOf(() => addHelpOut(db, krippe, { employeeId: anna, year: 2026, month: 11 }))).toEqual({ facility: 'Kindergarten' })
    // A helper column from before the pairs: no duty can be planned in it; emptying the cell works.
    addHelpOutRow(db, anna, krippe, 2026, 11, { pair: false })
    expect(errorCode(() => plan())).toBe('help_out_not_paired')
    plan('clear')
    expect(loadEntries(db, { employeeId: anna })).toEqual([])
    // With the pair: offered, and planned.
    setHelpoutPair(db, traeger, 1, krippe, true)
    expect(helpCandidates(db, hort, 2026, 11)).toEqual([])
    plan()
    expect(helperEntry()).toMatchObject({ date: TODAY, helpFacilityId: krippe })
    // Within a facility (a duty for another group) no pair is needed.
    const fuechse = addGroup(db, 1, 'Füchse')
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-25' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F1'), groupId: fuechse }, { now: NOW })
    expect(loadEntries(db, { employeeId: anna, from: '2026-11-25', to: '2026-11-25' })).toEqual([expect.objectContaining({ groupId: fuechse, helpFacilityId: null })])
    // The pair ended: the duty stays, but cannot be changed or planned again.
    setHelpoutPair(db, traeger, 1, krippe, false)
    const { id } = helperEntry()
    expect(errorCode(() => updateEntryTimes(db, leitungKrippe, krippe, id, { start: 480, end: 780, breakStart: null, breakEnd: null }, NOW))).toBe('help_out_not_paired')
    expect(errorCode(() => setEntryGroup(db, leitungKrippe, krippe, id, addGroup(db, krippe, 'Mäuse'), NOW))).toBe('help_out_not_paired')
    expect(errorCode(() => plan('replace', '2026-11-26'))).toBe('help_out_not_paired')
    expect(helperEntry()).toMatchObject({ id, start: 420 })
  })

  it('refuses to restore a helper\'s duties from the release without the pair', () => {
    setHelpoutPair(db, traeger, 1, krippe, true)
    addHelpOutRow(db, anna, krippe, 2026, 11)
    plan()
    releaseMonth(db, leitungKrippe, krippe, 2026, 11, NOW)
    plan('clear')
    setHelpoutPair(db, traeger, 1, krippe, false)
    expect(errorCode(() => revertToRelease(db, leitungKrippe, krippe, 2026, 11, [cellKey(anna, TODAY)], NOW))).toBe('help_out_not_paired')
    expect(loadEntries(db, { employeeId: anna })).toEqual([])
    setHelpoutPair(db, traeger, 1, krippe, true)
    expect(revertToRelease(db, leitungKrippe, krippe, 2026, 11, [cellKey(anna, TODAY)], NOW)).toBe(1)
    expect(helperEntry()).toMatchObject({ date: TODAY })
  })

  it('gives a planned help-out visibility only with the pair; ending it keeps the duties, marked in the plan and listed first', () => {
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setTimeTrackingFrom(db, krippe, '2026-10-01')
    setPin(db, 1, anna, '135790')
    setHelpoutPair(db, traeger, 1, krippe, true)
    addHelpOutRow(db, anna, krippe, 2026, 11)
    plan()
    plan('replace', '2026-11-27')
    const tablet = { id: addUser(db, 'tablet', 'terminal', null, krippe).id, facilityId: krippe }
    expect(terminalStatus(db, krippe, NOW).map(person => person.employeeId)).toContain(anna)
    expect(unlockChildren(db, tablet, anna, '135790', NOW).status).toMatchObject({ unlocked: true, employeeId: anna })
    expect(listHelpers(db, krippe, 2026, 11)).toEqual([expect.objectContaining({ employeeId: anna, paired: true })])
    // The planned help-outs from today on, named before the pair ends.
    expect(helpOutsBetween(db, traeger, krippe, 1, TODAY)).toEqual([
      { date: TODAY, employee: 'Anna', inFacility: 'Krippe', fromFacility: 'Kindergarten' },
      { date: '2026-11-27', employee: 'Anna', inFacility: 'Krippe', fromFacility: 'Kindergarten' },
    ])
    expect(helpOutsBetween(db, traeger, krippe, 1, '2026-11-25').map(entry => entry.date)).toEqual(['2026-11-27'])
    expect(errorCode(() => helpOutsBetween(db, leitungKrippe, krippe, 1, TODAY))).toBe('forbidden')
    setHelpoutPair(db, traeger, 1, krippe, false)
    // The duties stay (hours stay right), the column is marked, the tablet does not know her any more.
    expect(db.select().from(entries).all().filter(entry => entry.helpFacilityId === krippe)).toHaveLength(2)
    expect(listHelpers(db, krippe, 2026, 11)).toEqual([expect.objectContaining({ employeeId: anna, paired: false })])
    expect(terminalStatus(db, krippe, NOW).map(person => person.employeeId)).not.toContain(anna)
    expect(errorCode(() => unlockChildren(db, tablet, anna, '135790', NOW))).toBe('employee_not_found')
    // The Träger sees which facilities have help-outs without a pair (any date); the Leitung does not.
    expect(listHelpoutPairs(db, traeger).unpaired).toEqual([{ facilityIds: [1, krippe], names: ['Kindergarten', 'Krippe'], entries: 2 }])
    expect(listHelpoutPairs(db, leitungKrippe).unpaired).toEqual([])
    setHelpoutPair(db, traeger, krippe, 1, true)
    expect(listHelpoutPairs(db, traeger).unpaired).toEqual([])
  })
})
