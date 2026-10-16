import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { coverageRules } from '../../server/db/schema'
import { applyToCells } from '../../server/services/entries'
import { setFacilityOpeningHours, setGroupOpeningHours } from '../../server/services/openingHours'
import { getMonthPlan } from '../../server/services/plan'
import { createCoverageRule, updateCoverageRule } from '../../server/services/settings'
import type { DayHours, OpeningHours } from '../../shared/domain/openingHours'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addGroup, addUser, createTestDb, templateId } from '../helpers/fixtures'

const today = '2026-10-01'
const monday = '2026-10-05'
const tuesday = '2026-10-06'
const friday = '2026-10-09'
const saturday = '2026-10-10'

const none: DayHours = { open: null, close: null, closed: false }
const closed: DayHours = { open: null, close: null, closed: true }
const times = (open: number, close: number): DayHours => ({ open, close, closed: false })
/** Monday to Friday by weekday index; the other days are not entered. */
const week = (days: Record<number, DayHours>, minAtOpening = 1, minAtClosing = 1): OpeningHours => ({
  days: [0, 1, 2, 3, 4].map(index => days[index] ?? none), minAtOpening, minAtClosing,
})

describe('opening hours and weekday rules in the month plan', () => {
  let db: Db
  let admin: SessionUser
  let kaefer: number
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    kaefer = addGroup(db, 1, 'Käfer')
    anna = addEmployee(db, 'Anna', { groupId: kaefer })
    ben = addEmployee(db, 'Ben')
  })
  const write = (employeeId: number, date: string, label: string) =>
    applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })
  const plan = () => getMonthPlan(db, admin, 1, 2026, 10, today)
  const warnings = () => plan().admin!.warnings
  const edges = (date?: string) => warnings().filter(warning => warning.type === 'edge' && (date === undefined || warning.date === date))
  const coverage = (date: string) => warnings().filter(warning => warning.type === 'coverage' && warning.date === date)

  it('checks a rule only on its weekdays', () => {
    db.delete(coverageRules).run()
    const rule = createCoverageRule(db, 1, { label: 'Früh', start: 420, end: null, minCount: 1, active: true, weekdays: 1 | 2 | 4 | 8 })
    expect(coverage(tuesday).map(warning => (warning as { ruleId: number }).ruleId)).toEqual([rule.id])
    expect(coverage(friday)).toEqual([])
    updateCoverageRule(db, 1, rule.id, { label: 'Früh', start: 420, end: null, minCount: 1, active: true, weekdays: 16 })
    expect(coverage(tuesday)).toEqual([])
    expect(coverage(friday).map(warning => (warning as { ruleId: number }).ruleId)).toEqual([rule.id])
  })

  it('warns at the edges only with entered hours, and leaves every other warning as it was', () => {
    write(anna, tuesday, 'F1') // 7:00-13:15
    const before = warnings()
    expect(edges()).toEqual([])

    // Hours without any entered day are no hours.
    setFacilityOpeningHours(db, 1, week({}, 3, 3))
    expect(warnings()).toEqual(before)

    setFacilityOpeningHours(db, 1, week({ 1: times(420, 990) }, 1, 2))
    expect(edges(tuesday)).toEqual([{ type: 'edge', date: tuesday, edge: 'closing', time: 990, found: 0, required: 2 }])
    expect(warnings().filter(warning => warning.type !== 'edge')).toEqual(before)

    // Ben's duty (7:45-16:00) is neither at opening nor until closing.
    write(ben, tuesday, 'M')
    expect(edges(tuesday)).toEqual([{ type: 'edge', date: tuesday, edge: 'closing', time: 990, found: 0, required: 2 }])

    setFacilityOpeningHours(db, 1, null)
    expect(edges()).toEqual([])
  })

  it('names the group of its own hours and counts only its duties', () => {
    write(anna, tuesday, 'F1')
    write(ben, tuesday, 'F1') // Springer: facility only
    setFacilityOpeningHours(db, 1, week({ 1: times(420, 795) }))
    setGroupOpeningHours(db, 1, kaefer, week({ 1: times(420, 795) }, 2, 1))
    expect(edges(tuesday)).toEqual([
      { type: 'edge', date: tuesday, edge: 'opening', time: 420, found: 1, required: 2, groupName: 'Käfer' },
    ])
  })

  it('does not check the coverage rules on a closed weekday', () => {
    expect(coverage(friday).length).toBeGreaterThan(0)
    setFacilityOpeningHours(db, 1, week({ 4: closed }))
    expect(coverage(friday)).toEqual([])
    expect(coverage(tuesday).length).toBeGreaterThan(0)
  })

  it('gives each day the facility hours and the own hours of groups', () => {
    expect(plan().days.every(day => day.opening === null && Object.keys(day.groupOpening).length === 0)).toBe(true)
    setFacilityOpeningHours(db, 1, week({ 1: times(420, 990), 4: closed }))
    setGroupOpeningHours(db, 1, kaefer, week({ 1: times(480, 900) }))
    const day = (date: string) => plan().days.find(candidate => candidate.date === date)!
    expect(day(tuesday).opening).toEqual(times(420, 990))
    expect(day(tuesday).groupOpening).toEqual({ [kaefer]: times(480, 900) })
    expect(day(friday).opening).toEqual(closed)
    expect(day(friday).groupOpening).toEqual({})
    // Weekdays without entered hours and weekends have none.
    for (const date of [monday, saturday]) {
      expect(day(date).opening).toBeNull()
      expect(day(date).groupOpening).toEqual({})
    }
  })
})
