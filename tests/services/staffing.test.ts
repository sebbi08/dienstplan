import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { groups, staffingOverrides } from '../../server/db/schema'
import { updateFacility } from '../../server/services/facilities'
import { facilityHolidayRules } from '../../server/services/holidayRules'
import { listGroups, setGroupType } from '../../server/services/groups'
import {
  getStaffingSettings, resetStaffingOverrides, setStaffingOverrides, staffingRulesFor,
} from '../../server/services/staffing'
import { presetFor } from '../../shared/domain/staffing/presets'
import type { GermanState } from '../../shared/domain/states'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-22'
const REGEL = 'demand.regel.ftePerGroup'

let db: Db
let traeger: SessionUser
let leitung: SessionUser

beforeEach(() => {
  db = createTestDb()
  traeger = addUser(db, 'traeger', 'provider')
  leitung = addUser(db, 'leitung', 'admin')
})

const settings = (viewer: SessionUser = traeger, facilityId = 1) => getStaffingSettings(db, viewer, facilityId, TODAY)
const set = (values: Record<string, unknown>, actor: SessionUser = traeger, facilityId = 1) =>
  setStaffingOverrides(db, actor, facilityId, values, TODAY)
const valueOf = (path: string, facilityId = 1) => settings(traeger, facilityId).values.find(v => v.path === path)!

function changeState(state: GermanState, facilityId = 1) {
  const { assumptionDay } = facilityHolidayRules(db, facilityId)
  const name = facilityId === 1 ? 'Kindergarten' : 'Krippe'
  updateFacility(db, traeger, facilityId, { name, state, assumptionDay }, new Date(`${TODAY}T10:00:00Z`))
}

describe('staffing settings – reading', () => {
  it('shows the state preset valid today with its source, and nothing overridden', () => {
    const result = settings(leitung)
    const bw = presetFor('BW', TODAY)
    expect(result).toMatchObject({
      land: 'BW', validFrom: bw.validFrom, source: bw.source, confidence: 'high', method: 'group_fte', periodCheck: true,
      overrides: {}, ignored: [], upcomingIgnored: [], canEdit: false,
    })
    expect(result.effective).toEqual(bw)
    expect(result.values.find(v => v.path === REGEL)).toEqual({ path: REGEL, preset: 1.8, value: 1.8, overridden: false })
    expect(result.versions).toEqual([{ validFrom: bw.validFrom, source: bw.source, confidence: 'high' }])
    expect(settings(traeger).canEdit).toBe(true)
  })
})

describe('staffing settings – overrides', () => {
  it('the Träger overrides values; the effective rules use them, the preset stays as it is', () => {
    const result = set({ [REGEL]: 2.1, 'staffShares.azubi_1': 50, 'fteHoursPerWeek': 40 })
    expect(result.overrides).toEqual({ [REGEL]: 2.1, 'staffShares.azubi_1': 50, 'fteHoursPerWeek': 40 })
    expect(result.values.find(v => v.path === REGEL)).toEqual({ path: REGEL, preset: 1.8, value: 2.1, overridden: true })
    expect(result.effective.fteHoursPerWeek).toBe(40)
    expect(result.preset.fteHoursPerWeek).toBe(39)
    const rules = staffingRulesFor(db, 1, '2026-11-01').rules
    expect(rules.demand.find(r => r.groupType === 'regel' && !r.withAgeBand)!.ftePerGroup).toBe(2.1)
    expect(rules.staffShares.azubi_1).toBe(50)
    expect(presetFor('BW', TODAY).demand[3]!.ftePerGroup).toBe(1.8)
  })

  it('a value equal to the preset is no override', () => {
    expect(set({ [REGEL]: 1.8, 'fteHoursPerWeek': 39 }).overrides).toEqual({})
    expect(db.select().from(staffingOverrides).all()).toEqual([])
  })

  it('replaces the stored overrides with what is sent', () => {
    set({ [REGEL]: 2.1, 'fteHoursPerWeek': 40 })
    expect(set({ 'fteHoursPerWeek': 38 }).overrides).toEqual({ fteHoursPerWeek: 38 })
  })

  it('refuses unknown paths and anything but finite numbers, and keeps what was stored', () => {
    set({ [REGEL]: 2.1 })
    for (const values of [
      { 'demand.regel.groupType': 2 }, { 'demand.unknown.ftePerGroup': 2 }, { 'land': 1 }, { 'demand.regel.withAgeBand': 1 },
      { [REGEL]: '2' }, { [REGEL]: null }, { [REGEL]: Number.NaN }, { [REGEL]: Number.POSITIVE_INFINITY }, { [REGEL]: true },
      { 'staffShares.unknown': 10 }, { 'presence.always.minChildren': 3 },
    ]) {
      expect(errorCode(() => set(values)), JSON.stringify(values)).toBe('staffing_override_invalid')
    }
    expect(settings().overrides).toEqual({ [REGEL]: 2.1 })
  })

  it('refuses values that make the rules unusable, with the first problem as detail', () => {
    for (const values of [{ fteHoursPerWeek: 50 }, { 'staffShares.fachkraft': 120 }, { [REGEL]: -1 }, { 'staffShares.azubi_1': -5 }]) {
      expect(errorCode(() => set(values)), JSON.stringify(values)).toBe('staffing_rules_invalid')
    }
    expect(() => set({ fteHoursPerWeek: 29 })).toThrow(expect.objectContaining({
      statusCode: 400, details: { problem: expect.stringContaining('fteHoursPerWeek'), validFrom: presetFor('BW', TODAY).validFrom },
    }))
    expect(settings().overrides).toEqual({})
  })

  it('Review Focus 4: the Leitung cannot change or reset overrides (403); reset restores the preset', () => {
    set({ [REGEL]: 2.1 })
    expect(() => set({ [REGEL]: 2.5 }, leitung)).toThrow(expect.objectContaining({ statusCode: 403, code: 'forbidden' }))
    expect(() => resetStaffingOverrides(db, leitung, 1, null, TODAY))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'forbidden' }))
    expect(valueOf(REGEL).value).toBe(2.1)

    const reset = resetStaffingOverrides(db, traeger, 1, null, TODAY)
    expect(reset.overrides).toEqual({})
    expect(reset.effective).toEqual(presetFor('BW', TODAY))
    expect(staffingRulesFor(db, 1, TODAY).rules).toEqual(presetFor('BW', TODAY))
    expect(db.select().from(staffingOverrides).all()).toEqual([])
  })

  it('resets a single value and keeps the others', () => {
    set({ [REGEL]: 2.1, 'staffShares.azubi_1': 50 })
    expect(resetStaffingOverrides(db, traeger, 1, REGEL, TODAY).overrides).toEqual({ 'staffShares.azubi_1': 50 })
    expect(valueOf(REGEL)).toMatchObject({ value: 1.8, overridden: false })
    // A path without an override: nothing changes.
    expect(resetStaffingOverrides(db, traeger, 1, 'fteHoursPerWeek', TODAY).overrides).toEqual({ 'staffShares.azubi_1': 50 })
  })

  it('falls back to the preset when stored overrides are unusable or malformed', () => {
    const store = (overrides: string) => db.insert(staffingOverrides)
      .values({ facilityId: 1, overrides, updatedAt: '2026-10-22T08:00:00.000Z' })
      .onConflictDoUpdate({ target: staffingOverrides.facilityId, set: { overrides } }).run()
    store(JSON.stringify({ fteHoursPerWeek: { value: 99, preset: 39 } }))
    expect(staffingRulesFor(db, 1, TODAY)).toMatchObject({ rules: presetFor('BW', TODAY), applied: [], ignored: ['fteHoursPerWeek'] })
    store('not json')
    expect(settings().overrides).toEqual({})
    store(JSON.stringify({ fteHoursPerWeek: 40, [REGEL]: { value: 2.1, preset: 1.8 } }))
    expect(settings().overrides).toEqual({ [REGEL]: 2.1 })
  })

  it('belongs to one facility', () => {
    const krippe = addFacility(db, 'Krippe')
    set({ [REGEL]: 2.1 })
    expect(settings(traeger, krippe).overrides).toEqual({})
    expect(staffingRulesFor(db, krippe, TODAY).rules).toEqual(presetFor('BW', TODAY))
  })

  it('follows the law: an override lapses for a version that changes the overridden value', () => {
    changeState('BB')
    const u3 = 'demand.u3+h<=30.childrenPerFte'
    const ue3 = 'demand.ue3+h<=30.childrenPerFte'
    set({ [u3]: 4.5, [ue3]: 9 })
    const december = staffingRulesFor(db, 1, '2026-12-01')
    expect(december.rules.demand[0]!.childrenPerFte).toBe(4.5)
    expect(december.ignored).toEqual([])
    // From 2027 the law says 4 instead of 4.25: the new law value counts, the unchanged ue3 value keeps its override.
    const january = staffingRulesFor(db, 1, '2027-01-01')
    expect(january.rules.demand[0]!.childrenPerFte).toBe(4)
    expect(january.rules.demand[2]!.childrenPerFte).toBe(9)
    expect(january.ignored).toEqual([u3])
    expect(january.rules.validFrom).toBe('2027-01-01')
    // The settings warn in advance.
    expect(settings().upcomingIgnored).toEqual([{ validFrom: '2027-01-01', path: u3, value: 4.5, preset: 4.25 }])
  })

  it('keeps ignored overrides apart: re-saving after the version change neither re-arms nor fails', () => {
    changeState('BB')
    const u3 = 'demand.u3+h<=30.childrenPerFte'
    const ue3 = 'demand.ue3+h<=30.childrenPerFte'
    set({ [u3]: 4.5, [ue3]: 9 })
    const LATER = '2027-02-01'
    const later = getStaffingSettings(db, traeger, 1, LATER)
    expect(later.overrides).toEqual({ [ue3]: 9 })
    expect(later.ignored).toEqual([{ path: u3, value: 4.5, preset: 4.25 }])
    expect(later.upcomingIgnored).toEqual([])
    expect(later.values.find(v => v.path === u3)).toEqual({ path: u3, preset: 4, value: 4, overridden: false })

    const u3On = (date: string) => staffingRulesFor(db, 1, date).rules.demand[0]!.childrenPerFte
    const ue3On = (date: string) => staffingRulesFor(db, 1, date).rules.demand[2]!.childrenPerFte
    // Sending back the active overrides, or every value of the form, changes nothing.
    setStaffingOverrides(db, traeger, 1, later.overrides, LATER)
    setStaffingOverrides(db, traeger, 1, Object.fromEntries(later.values.map(v => [v.path, v.value])), LATER)
    expect([u3On('2026-12-01'), u3On('2027-01-01'), ue3On('2026-12-01'), ue3On('2027-01-01')]).toEqual([4.5, 4, 9, 9])
    expect(getStaffingSettings(db, traeger, 1, LATER).ignored).toEqual([{ path: u3, value: 4.5, preset: 4.25 }])

    // Leaving the active one out resets it everywhere; the ignored one stays for 2026.
    setStaffingOverrides(db, traeger, 1, {}, LATER)
    expect([u3On('2026-12-01'), ue3On('2026-12-01'), ue3On('2027-01-01')]).toEqual([4.5, 10, 10])
    // Only DELETE ?path= removes an ignored override.
    const reset = resetStaffingOverrides(db, traeger, 1, u3, LATER)
    expect(reset).toMatchObject({ overrides: {}, ignored: [], droppedOthers: false })
    expect(u3On('2026-12-01')).toBe(4.25)
    expect(db.select().from(staffingOverrides).all()).toEqual([])
  })

  it('a new value for an ignored path is a new override against today\'s preset', () => {
    changeState('BB')
    const u3 = 'demand.u3+h<=30.childrenPerFte'
    set({ [u3]: 4.5 })
    const LATER = '2027-02-01'
    const result = setStaffingOverrides(db, traeger, 1, { [u3]: 3.8 }, LATER)
    expect(result).toMatchObject({ overrides: { [u3]: 3.8 }, ignored: [] })
    expect(staffingRulesFor(db, 1, '2027-01-01').rules.demand[0]!.childrenPerFte).toBe(3.8)
    expect(staffingRulesFor(db, 1, '2026-12-01').rules.demand[0]!.childrenPerFte).toBe(4.25)
  })

  it('a reset of one value never fails: when the rest no longer fits together, it goes too', () => {
    changeState('TH') // Leitung: minFte 0.2, capFte 1.5
    set({ 'addOns.leitung.minFte': 1.8, 'addOns.leitung.capFte': 2, 'staffShares.azubi_1': 50 })
    const result = resetStaffingOverrides(db, traeger, 1, 'addOns.leitung.capFte', TODAY)
    expect(result).toMatchObject({ overrides: {}, ignored: [], droppedOthers: true })
    expect(result.effective).toEqual(presetFor('TH', TODAY))
    expect(db.select().from(staffingOverrides).all()).toEqual([])
  })
})

describe('staffing settings – state change', () => {
  it('keeps only the overrides that apply to the new state and clears group types it does not know', () => {
    const baeren = addGroup(db, 1, 'Bären')
    setGroupType(db, 1, baeren, 'regel', TODAY)
    set({ [REGEL]: 2.1, 'staffShares.fachkraft': 90, 'fteHoursPerWeek': 40 })
    changeState('BY')
    // BY has no Regelgruppe; Fachkraft 100 % and 39 h are BY values too.
    expect(settings().overrides).toEqual({ 'staffShares.fachkraft': 90, 'fteHoursPerWeek': 40 })
    expect(settings().land).toBe('BY')
    expect(listGroups(db, 1)[0]!.groupType).toBeNull()
  })

  it('drops an override whose preset value differs in the new state', () => {
    set({ fteHoursPerWeek: 40 })
    changeState('BE') // BE: 38.5 h
    expect(settings().overrides).toEqual({})
  })

  it('keeps everything on a plain rename', () => {
    const baeren = addGroup(db, 1, 'Bären')
    setGroupType(db, 1, baeren, 'regel', TODAY)
    set({ [REGEL]: 2.1 })
    changeState('BW')
    expect(settings().overrides).toEqual({ [REGEL]: 2.1 })
    expect(listGroups(db, 1)[0]!.groupType).toBe('regel')
  })
})

describe('group type', () => {
  it('is empty at first; the manager sets a type of the state or none', () => {
    const baeren = addGroup(db, 1, 'Bären')
    expect(listGroups(db, 1)[0]!.groupType).toBeNull()
    setGroupType(db, 1, baeren, 'krippe', TODAY)
    expect(listGroups(db, 1)[0]!.groupType).toBe('krippe')
    setGroupType(db, 1, baeren, null, TODAY)
    expect(listGroups(db, 1)[0]!.groupType).toBeNull()
  })

  it('refuses keys the state does not have, and groups of other facilities', () => {
    const baeren = addGroup(db, 1, 'Bären')
    for (const key of ['unknown', '', 'Regel']) {
      expect(errorCode(() => setGroupType(db, 1, baeren, key, TODAY)), key).toBe('staffing_group_type_invalid')
    }
    const krippe = addFacility(db, 'Krippe')
    const wichtel = addGroup(db, krippe, 'Wichtel')
    expect(errorCode(() => setGroupType(db, 1, wichtel, 'regel', TODAY))).toBe('group_not_found')
    changeState('BY', krippe)
    expect(errorCode(() => setGroupType(db, krippe, wichtel, 'regel', TODAY))).toBe('staffing_group_type_invalid')
    expect(db.select({ groupType: groups.groupType }).from(groups).where(eq(groups.id, wichtel)).get()).toEqual({ groupType: null })
  })
})
