import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { facilities, groups } from '../../server/db/schema'
import { staffingEstimatePreviewQuery } from '../../server/schemas'
import { createCareType } from '../../server/services/careTypes'
import { setFacilityOpeningHours, setGroupOpeningHours } from '../../server/services/openingHours'
import {
  estimateFacility, estimateGroup, staffingEstimate, staffingEstimatePreview, type EstimateGroupInput,
} from '../../server/services/staffingEstimate'
import { staffingMonth } from '../../server/services/staffingReport'
import { presetFor } from '../../shared/domain/staffing/presets'
import type { OpeningHours } from '../../shared/domain/openingHours'
import type { GermanState } from '../../shared/domain/states'
import { addChild, addFacility, addGroup, createTestDb } from '../helpers/fixtures'

const TODAY = '2026-10-15'
const BW = presetFor('BW', TODAY)
const MV = presetFor('MV', TODAY)
const BY = presetFor('BY', TODAY)
const HB = presetFor('HB', TODAY)

const input = (over: Partial<EstimateGroupInput> = {}): EstimateGroupInput => ({
  groupType: 'regel', capacity: 25, forSchoolChildren: false, openingMinutesPerDay: 360, hasU3Now: false, ...over,
})

describe('estimateGroup – BW (group_fte)', () => {
  it('a Regelgruppe with 25 places open 6 h a day: 1.8 FTE = 70.2 h a week, all places full-time', () => {
    const result = estimateGroup(BW, input())
    expect(result).toMatchObject({ reason: null, periodCheck: true, groupType: 'regel', groupTypeLabel: 'Regelgruppe', capacity: 25 })
    expect(result.fte).toBeCloseTo(1.8, 9)
    expect(result.hoursPerWeek).toBeCloseTo(1.8 * 39, 9)
    expect(result.lines).toEqual([expect.objectContaining({ key: 'demand', counts: true })])
    expect(result.assumptions).toEqual({ children: 25, u3: 0, school: 0, weeklyHoursPerChild: 30, hoursSource: 'opening' })
    // „mit U3“ would be 2.0: shown as a hint, not assumed.
    expect(result.withU3Fte).toBeCloseTo(2.0, 9)
  })

  it('scales with the opening hours like the monthly report', () => {
    expect(estimateGroup(BW, input({ openingMinutesPerDay: 540 })).fte).toBeCloseTo(1.8 * 9 / 6, 9)
  })

  it('a Kinderkrippe counts every place as under 3', () => {
    const result = estimateGroup(BW, input({ groupType: 'krippe', capacity: 10, openingMinutesPerDay: 420 }))
    expect(result.fte).toBeCloseTo(2.06, 9)
    expect(result.assumptions).toMatchObject({ children: 10, u3: 10 })
    expect(result.withU3Fte).toBeNull()
  })

  it('a group with children under 3 now counts as „mit U3“: exactly one place under 3', () => {
    const result = estimateGroup(BW, input({ hasU3Now: true }))
    expect(result.fte).toBeCloseTo(2.0, 9)
    expect(result.assumptions).toMatchObject({ children: 25, u3: 1 })
    expect(result.withU3Fte).toBeNull()
  })

  it('without opening hours takes the reference hours of the group type', () => {
    const result = estimateGroup(BW, input({ groupType: 'ganztag', openingMinutesPerDay: null }))
    expect(result.reason).toBeNull()
    expect(result.fte).toBeCloseTo(2.3, 9)
    expect(result.assumptions).toMatchObject({ weeklyHoursPerChild: 35, hoursSource: 'reference' })
  })

  it('names the presence rules of the group type', () => {
    expect(estimateGroup(BW, input()).presence).toEqual([
      { window: 'always', minStaff: null, minFachkraft: 1, minChildren: null, perChildren: null },
    ])
    expect(estimateGroup(BW, input({ groupType: 'voe' })).presence.map(rule => [rule.window, rule.minFachkraft]))
      .toEqual([['always', 1], ['haupt', 2]])
  })

  it('gives a reason instead of figures when something is missing', () => {
    expect(estimateGroup(BW, input({ groupType: null }))).toMatchObject({ reason: 'no_group_type', fte: null, hoursPerWeek: null, assumptions: null })
    expect(estimateGroup(BW, input({ groupType: 'gibtsnicht' }))).toMatchObject({ reason: 'unknown_group_type', fte: null, groupTypeLabel: null })
    expect(estimateGroup(BW, input({ capacity: null }))).toMatchObject({ reason: 'no_capacity', fte: null })
    // Without a group type only the rules for every group apply.
    expect(estimateGroup(BW, input({ groupType: null })).presence.map(rule => rule.window)).toEqual(['always'])
  })
})

describe('estimateGroup – per-child states', () => {
  it('MV (fte_per_child): 14 places at 10 h a day = 50 h a week are one FTE; no group type needed', () => {
    const result = estimateGroup(MV, input({ groupType: null, capacity: 14, openingMinutesPerDay: 600 }))
    expect(result.reason).toBeNull()
    expect(result.fte).toBeCloseTo(1, 9)
    expect(result.assumptions).toMatchObject({ weeklyHoursPerChild: 50, hoursSource: 'opening' })
    // One child under 3 would add 1/6 − 1/14.
    expect(result.withU3Fte).toBeCloseTo(13 / 14 + 1 / 6, 9)
  })

  it('MV: a group for school children counts its places as school children', () => {
    const result = estimateGroup(MV, input({ groupType: null, capacity: 22, openingMinutesPerDay: 600, forSchoolChildren: true }))
    expect(result.fte).toBeCloseTo(1, 9)
    expect(result.assumptions).toMatchObject({ u3: 0, school: 22 })
    expect(result.withU3Fte).toBeNull()
  })

  it('BY (child_hours): 11 places at 40 h a week need 40 staff hours = 40/39 FTE', () => {
    const result = estimateGroup(BY, input({ groupType: null, capacity: 11, openingMinutesPerDay: 480 }))
    expect(result.fte).toBeCloseTo(40 / 39, 9)
    expect(result.hoursPerWeek).toBeCloseTo(40, 9)
  })

  it('without any opening hours a per-child state cannot estimate', () => {
    expect(estimateGroup(MV, input({ groupType: null, openingMinutesPerDay: null }))).toMatchObject({ reason: 'no_opening_hours', fte: null })
    expect(estimateGroup(BY, input({ groupType: null, openingMinutesPerDay: null }))).toMatchObject({ reason: 'no_opening_hours', fte: null })
  })
})

describe('estimateGroup – presence-only state (HB)', () => {
  it('shows the presence rules only', () => {
    const result = estimateGroup(HB, input({ groupType: 'krippe', capacity: 10 }))
    expect(result).toMatchObject({ periodCheck: false, reason: null, fte: null, hoursPerWeek: null, lines: [] })
    expect(result.presence).toContainEqual({
      window: 'always', minStaff: null, minFachkraft: null, minChildren: null, perChildren: { children: 10, staff: 2, fachkraft: 1 },
    })
    expect(estimateGroup(HB, input({ groupType: 'kindergarten' })).presence
      .some(rule => rule.perChildren?.children === 10)).toBe(false)
  })
})

describe('estimateFacility', () => {
  it('BW: the groups with an estimate plus Leitung 6 h for the first and 2 h for each further group (shown only)', () => {
    const result = estimateFacility(BW, [
      input(), input({ groupType: 'krippe', capacity: 10, openingMinutesPerDay: 420 }), input({ groupType: null }),
    ])
    expect(result).toMatchObject({ periodCheck: true, groupCount: 2, groupsWithout: 1 })
    expect(result.fte).toBeCloseTo(1.8 + 2.06, 9)
    expect(result.hoursPerWeek).toBeCloseTo((1.8 + 2.06) * 39, 9)
    const leitung = result.lines.find(line => line.key === 'leitung')!
    expect(leitung.counts).toBe(false)
    expect(leitung.fte * 39).toBeCloseTo(8, 9)
    expect(result.lines.find(line => line.key === 'demand')!.fte).toBeCloseTo(1.8 + 2.06, 9)
  })

  it('without any group with an estimate has no figures', () => {
    expect(estimateFacility(BW, [input({ capacity: null })])).toMatchObject({ fte: null, hoursPerWeek: null, groupCount: 0, groupsWithout: 1 })
  })

  it('a presence-only state has no facility figures', () => {
    expect(estimateFacility(HB, [input({ groupType: 'krippe' })])).toMatchObject({ periodCheck: false, fte: null, lines: [] })
  })
})

describe('staffingEstimatePreviewQuery', () => {
  it('reads empty and missing values as „not entered“, and refuses places outside 1–200', () => {
    expect(staffingEstimatePreviewQuery.parse({ groupType: '', capacity: '20' })).toEqual({ groupType: null, capacity: 20, groupId: null })
    expect(staffingEstimatePreviewQuery.parse({ groupType: 'regel', groupId: '4' })).toEqual({ groupType: 'regel', capacity: null, groupId: 4 })
    expect(() => staffingEstimatePreviewQuery.parse({ capacity: '0' })).toThrow()
    expect(() => staffingEstimatePreviewQuery.parse({ capacity: '201' })).toThrow()
  })
})

describe('staffingEstimate (database)', () => {
  let db: Db
  let bears: number
  let mice: number
  const allWeek = (open: number, close: number): OpeningHours => ({
    days: [0, 1, 2, 3, 4].map(() => ({ open, close, closed: false })), minAtOpening: 1, minAtClosing: 1,
  })
  const setGroup = (id: number, values: { groupType?: string | null; capacity?: number | null; forSchoolChildren?: boolean }) =>
    db.update(groups).set(values).where(eq(groups.id, id)).run()
  const setState = (state: GermanState) => db.update(facilities).set({ state }).where(eq(facilities.id, 1)).run()
  const careType = () => createCareType(db, 1, { name: 'Ganztag', start: 420, end: 900, sortOrder: 0, daysPerWeek: 5 }).id
  const kids = (count: number, groupId: number, careTypeId: number | null, birthDate = '2022-03-15') =>
    Array.from({ length: count }, (_, i) =>
      addChild(db, 1, { firstName: `K${i}`, lastName: `G${groupId}`, groupId, careTypeId, birthDate, entryDate: '2025-09-01' }))

  beforeEach(() => {
    db = createTestDb()
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    setGroup(bears, { groupType: 'regel', capacity: 25 })
    setGroup(mice, { groupType: 'krippe', capacity: 10 })
    setFacilityOpeningHours(db, 1, allWeek(420, 780)) // 6 h
  })

  it('lists every group with its estimate, and the facility with Leitung', () => {
    const result = staffingEstimate(db, 1, TODAY)
    expect(result).toMatchObject({ land: 'BW', fteHoursPerWeek: 39, confidence: 'high' })
    expect(result.groups.map(group => [group.groupId, group.name])).toEqual([[bears, 'Bären'], [mice, 'Mäuse']])
    expect(result.groups[0]!.fte).toBeCloseTo(1.8, 9)
    expect(result.groups[1]!.fte).toBeCloseTo(2.06 * 6 / 7, 9)
    expect(result.facility.groupCount).toBe(2)
    expect(result.facility.fte).toBeCloseTo(1.8 + 2.06 * 6 / 7, 9)
    expect(result.facility.lines.find(line => line.key === 'leitung')!.fte * 39).toBeCloseTo(8, 9)
  })

  it('takes the group\'s own opening hours (the same average as the monthly report)', () => {
    setGroupOpeningHours(db, 1, bears, allWeek(420, 960)) // 9 h
    expect(staffingEstimate(db, 1, TODAY).groups[0]!.fte).toBeCloseTo(1.8 * 9 / 6, 9)
    expect(staffingEstimate(db, 1, TODAY).groups[0]!.assumptions!.weeklyHoursPerChild).toBeCloseTo(45, 9)
  })

  it('„Aktuell“ is the Soll of this month\'s Personalschlüssel tab, with the counted children', () => {
    const ganztag = careType()
    kids(20, bears, ganztag)
    kids(4, mice, ganztag, '2025-01-10')
    const result = staffingEstimate(db, 1, TODAY)
    const month = staffingMonth(db, 1, 2026, 10)
    for (const group of result.groups) {
      const row = month.groups.find(candidate => candidate.groupId === group.groupId)!
      expect(group.current).toEqual({ children: row.children.total, u3: row.children.u3, fte: row.required.fte })
    }
    expect(result.groups[0]!.current!.children).toBe(20)
    expect(result.facility.current).toEqual({ children: 24, u3: 4, fte: month.total.required.fte })
  })

  it('assumes one child under 3 in a group that has children under 3 now', () => {
    kids(1, bears, careType(), '2025-01-10')
    const bearsEstimate = staffingEstimate(db, 1, TODAY).groups[0]!
    expect(bearsEstimate.assumptions!.u3).toBe(1)
    expect(bearsEstimate.fte).toBeCloseTo(2.0, 9)
  })

  it('a presence-only state has no „Aktuell“', () => {
    setState('HB')
    setGroup(bears, { groupType: 'krippe' })
    const result = staffingEstimate(db, 1, TODAY)
    expect(result.groups[0]).toMatchObject({ periodCheck: false, current: null })
    expect(result.facility.current).toBeNull()
  })

  it('previews a new group with the facility\'s hours, and the facility with it', () => {
    const preview = staffingEstimatePreview(db, 1, { groupType: 'regel', capacity: 20, groupId: null }, TODAY)
    expect(preview.group).toMatchObject({ groupId: null, name: '', current: null, capacity: 20 })
    expect(preview.group.fte).toBeCloseTo(1.8, 9)
    expect(preview.facility.groupCount).toBe(3)
    expect(preview.facility.lines.find(line => line.key === 'leitung')!.fte * 39).toBeCloseTo(10, 9)
  })

  it('previews an existing group with other values, using its own hours', () => {
    setGroupOpeningHours(db, 1, bears, allWeek(420, 960))
    const preview = staffingEstimatePreview(db, 1, { groupType: 'ganztag', capacity: 22, groupId: bears }, TODAY)
    expect(preview.group).toMatchObject({ groupId: bears, name: 'Bären', groupType: 'ganztag', capacity: 22 })
    expect(preview.group.fte).toBeCloseTo(2.3 * 9 / 7, 9)
    expect(preview.facility.groupCount).toBe(2)
    expect(preview.facility.fte).toBeCloseTo(2.3 * 9 / 7 + 2.06 * 6 / 7, 9)
  })

  it('refuses a group of another facility in the preview', () => {
    const other = addGroup(db, addFacility(db, 'Zweite'), 'Fremd')
    expect(() => staffingEstimatePreview(db, 1, { groupType: 'regel', capacity: 20, groupId: other }, TODAY))
      .toThrow(expect.objectContaining({ statusCode: 404, code: 'group_not_found' }))
  })
})
