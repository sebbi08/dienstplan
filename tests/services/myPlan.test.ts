import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import type { EntryInput, MyPlanDto, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

// 2026-10-05 is a Monday.
const monday = '2026-10-05'
const tuesday = '2026-10-06'
const today = '2026-10-01'

describe('my plan with help-outs', () => {
  let db: Db
  let leitungA: SessionUser
  let krippe: number
  let leitungB: SessionUser
  let anna: number
  let kim: number
  let annaAccount: SessionUser

  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    leitungA = addUser(db, 'leitung-a', 'admin')
    leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    anna = addEmployee(db, 'Anna')
    kim = addEmployee(db, 'Kim', { facilityId: krippe })
    addHelpOut(db, anna, krippe, 2026, 10)
    annaAccount = addUser(db, 'anna', 'observer', anna)
  })

  const shiftIn = (facilityId: number, label = 'F1', note: string | null = null): EntryInput =>
    ({ kind: 'shift', templateId: templateId(db, label, facilityId), note })
  const write = (actor: SessionUser, facilityId: number, date: string, input: EntryInput, employeeId = anna) =>
    applyToCells(db, actor, facilityId, [{ employeeId, date }], 'replace', input)
  const release = (actor: SessionUser, facilityId: number, at: string) => releaseMonth(db, actor, facilityId, 2026, 10, new Date(at))
  const mine = () => getMyPlan(db, annaAccount, 2026, 10, today)
  const day = (plan: MyPlanDto, date: string) => plan.days.find(row => row.date === date)!
  const shown = (plan: MyPlanDto, date: string) =>
    day(plan, date).entries.map(entry => [entry.shortLabel, entry.helpFacilityId, entry.helpFacilityName ?? null, entry.note])

  it('shows the help-out day only once B has released it', () => {
    write(leitungA, 1, monday, shiftIn(1, 'M'))
    write(leitungB, krippe, tuesday, shiftIn(krippe, 'F1', 'Schlüssel bei Kim'))
    write(leitungB, krippe, tuesday, shiftIn(krippe, 'F2'), kim)
    release(leitungA, 1, '2026-09-25T10:00:00Z')
    // A's release has the marker, but B has not released yet.
    expect(shown(mine(), monday)).toEqual([['M', null, null, null]])
    expect(shown(mine(), tuesday)).toEqual([])

    release(leitungB, krippe, '2026-09-25T11:00:00Z')
    expect(shown(mine(), monday)).toEqual([['M', null, null, null]])
    // The helper sees B's duty in full, once: not also as A's marker.
    expect(shown(mine(), tuesday)).toEqual([['F1', krippe, 'Krippe', 'Schlüssel bei Kim']])
  })

  it('shows B\'s released days while the home month is unreleased; with neither released there is no plan', () => {
    write(leitungA, 1, monday, shiftIn(1, 'M'))
    write(leitungB, krippe, tuesday, shiftIn(krippe))
    expect(errorCode(() => mine())).toBe('month_not_released')

    release(leitungB, krippe, '2026-09-25T11:00:00Z')
    const plan = mine()
    expect(shown(plan, monday)).toEqual([])
    expect(shown(plan, tuesday)).toEqual([['F1', krippe, 'Krippe', null]])
    expect(plan.days).toHaveLength(31)
    expect(plan.release).toEqual({ releasedAt: null, releasedBy: null, changeCount: 0, pendingCount: 0 })
  })

  it('a day in two releases shows the newer release\'s entries only', () => {
    // A newer: A's "Krank" over a released help-out is released before B re-releases.
    write(leitungB, krippe, tuesday, shiftIn(krippe))
    release(leitungA, 1, '2026-09-25T10:00:00Z')
    release(leitungB, krippe, '2026-09-25T11:00:00Z')
    write(leitungA, 1, tuesday, { kind: 'code', codeId: codeId(db, 'sick') })
    release(leitungA, 1, '2026-09-26T10:00:00Z')
    expect(day(mine(), tuesday).entries.map(entry => [entry.codeKey, entry.helpFacilityId])).toEqual([['sick', null]])

    // B newer: A cleared Monday's released duty but has not re-released; B plans and releases the help-out there.
    write(leitungA, 1, monday, shiftIn(1, 'M'))
    release(leitungA, 1, '2026-09-27T10:00:00Z')
    applyToCells(db, leitungA, 1, [{ employeeId: anna, date: monday }], 'clear', null)
    write(leitungB, krippe, monday, shiftIn(krippe, 'F2'))
    release(leitungB, krippe, '2026-09-27T11:00:00Z')
    expect(shown(mine(), monday)).toEqual([['F2', krippe, 'Krippe', null]])
    // Tuesday: B's newer release no longer has the help-out, so A's "Krank" stays.
    expect(day(mine(), tuesday).entries.map(entry => entry.codeKey)).toEqual(['sick'])
  })

  it('attaches B\'s change history to the help-out cell', () => {
    write(leitungB, krippe, tuesday, shiftIn(krippe))
    release(leitungA, 1, '2026-09-25T10:00:00Z')
    release(leitungB, krippe, '2026-09-25T11:00:00Z')
    expect(day(mine(), tuesday).changes).toEqual([])

    write(leitungB, krippe, tuesday, shiftIn(krippe, 'F2'))
    // B's draft is not shown to the helper.
    expect(shown(mine(), tuesday).map(entry => entry[0])).toEqual(['F1'])
    release(leitungB, krippe, '2026-09-26T11:00:00Z')
    const plan = mine()
    expect(shown(plan, tuesday).map(entry => entry[0])).toEqual(['F2'])
    expect(day(plan, tuesday).changes).toEqual([expect.objectContaining({
      field: 'entry', employeeId: anna, date: tuesday, before: expect.stringContaining('F1'), after: expect.stringContaining('F2'),
      changedAt: '2026-09-26T11:00:00.000Z', changedBy: 'leitung-b',
    })])
    expect(plan.release.changeCount).toBe(1)
  })

  it('after A\'s "Krank" replaced the help-out, shows A\'s entry with both facilities\' changes of the day', () => {
    write(leitungB, krippe, tuesday, shiftIn(krippe))
    release(leitungA, 1, '2026-09-25T10:00:00Z')
    release(leitungB, krippe, '2026-09-25T11:00:00Z')
    write(leitungA, 1, tuesday, { kind: 'code', codeId: codeId(db, 'sick') })
    release(leitungA, 1, '2026-09-26T10:00:00Z')
    release(leitungB, krippe, '2026-09-26T11:00:00Z')
    const plan = mine()
    expect(day(plan, tuesday).entries.map(entry => [entry.codeKey, entry.helpFacilityId])).toEqual([['sick', null]])
    expect(day(plan, tuesday).changes.map(change => [change.changedBy, change.before.includes('F1'), change.after])).toEqual([
      ['leitung-a', false, expect.stringContaining('Krank')],
      ['leitung-b', true, '—'],
    ])
    expect(plan.release.changeCount).toBe(1)
  })
})
