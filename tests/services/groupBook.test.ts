import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { closures, facilities, groupBookChanges, groupDayNotes, groupWeekNotes } from '../../server/db/schema'
import type { ChildActor, ChildViewer } from '../../server/lib/childViewer'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { deleteGroup } from '../../server/services/groups'
import {
  getGroupWeek, groupBookHistory, setDayNote, setWeekTheme,
} from '../../server/services/groupBook'
import { setReadAccess } from '../../server/services/groupReadAccess'
import { setTabletSettings } from '../../server/services/tabletSettings'
import { resolveChildViewer, unlockChildren } from '../../server/services/tabletUnlock'
import { setPin } from '../../server/services/terminal'
import {
  addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode,
} from '../helpers/fixtures'

const NOW = new Date('2026-10-14T08:00:00Z')
const LATER = new Date('2026-10-14T09:30:00Z')
const MONDAY = '2026-10-12' // KW 42
const TUESDAY = '2026-10-13'
const FRIDAY = '2026-10-16'

describe('group book weekly overview', () => {
  let db: Db
  let leitung: ChildActor
  let a: number
  let b: number
  let c: number
  let atTablet: ChildViewer

  beforeEach(() => {
    db = createTestDb()
    a = addGroup(db, 1, 'Bären')
    b = addGroup(db, 1, 'Mäuse')
    c = addGroup(db, 1, 'Füchse')
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    setTimeTrackingFrom(db, 1, '2026-10-01')
    setTabletSettings(db, 1, { lockMinutes: 10, showWaitlist: true, showFutureContracts: true })
    // Anna (group Bären, may also read Mäuse) unlocks the tablet; she has no account of her own.
    const tablet = addUser(db, 'tablet', 'terminal')
    const anna = addEmployee(db, 'Anna Beispiel', { groupId: a })
    setPin(db, 1, anna, '123456')
    setReadAccess(db, 1, a, [b])
    const token = unlockChildren(db, { id: tablet.id, facilityId: 1 }, anna, '123456', NOW).token
    atTablet = resolveChildViewer(db, tablet, token, NOW)
  })

  it('stores the theme and a day note and logs them with the name of the tablet person', () => {
    expect(atTablet).toMatchObject({ id: null, groups: { own: a, readable: [b] } })
    setWeekTheme(db, atTablet, a, MONDAY, 'Herbst', NOW)
    setDayNote(db, atTablet, a, TUESDAY, 'Blätter gesammelt', NOW)
    setDayNote(db, atTablet, a, TUESDAY, 'Blätter gesammelt und gebastelt', LATER)

    const week = getGroupWeek(db, atTablet, a, FRIDAY)
    expect(week).toMatchObject({
      groupId: a, groupName: 'Bären', weekStart: MONDAY, weekNumber: 42, canWrite: true,
      theme: { text: 'Herbst', updatedAt: NOW.toISOString(), updatedByName: 'Anna Beispiel' },
    })
    expect(week.days.map(day => day.date)).toEqual([MONDAY, TUESDAY, '2026-10-14', '2026-10-15', FRIDAY])
    expect(week.days[0]!.note).toEqual({ text: '', updatedAt: null, updatedByName: null })
    expect(week.days[1]!.note).toEqual({
      text: 'Blätter gesammelt und gebastelt', updatedAt: LATER.toISOString(), updatedByName: 'Anna Beispiel',
    })

    expect(groupBookHistory(db, atTablet, a, 'day', TUESDAY)).toEqual([
      { id: expect.any(Number), before: 'Blätter gesammelt', after: 'Blätter gesammelt und gebastelt', changedAt: LATER.toISOString(), changedByName: 'Anna Beispiel' },
      { id: expect.any(Number), before: '', after: 'Blätter gesammelt', changedAt: NOW.toISOString(), changedByName: 'Anna Beispiel' },
    ])
    expect(groupBookHistory(db, atTablet, a, 'week', FRIDAY)).toHaveLength(1)
    expect(groupBookHistory(db, atTablet, a, 'week', MONDAY)[0]).toMatchObject({ before: '', after: 'Herbst' })
    expect(db.select().from(groupBookChanges).all().map(row => [row.groupId, row.field, row.date, row.changedByUserId, row.changedByName]))
      .toEqual([[a, 'week', MONDAY, null, 'Anna Beispiel'], [a, 'day', TUESDAY, null, 'Anna Beispiel'], [a, 'day', TUESDAY, null, 'Anna Beispiel']])
    expect(db.select().from(groupBookChanges).all()[0]!.changedByEmployeeId).not.toBeNull()
  })

  it('opens the own group without a group given, otherwise the first one the viewer sees', () => {
    // Anna's own group comes first even when it is not the facility's first one.
    const anna = { ...atTablet, groups: { own: c, readable: [a] } }
    expect(getGroupWeek(db, anna, null, FRIDAY)).toMatchObject({ groupId: c, canWrite: true })
    expect(getGroupWeek(db, leitung, null, FRIDAY)).toMatchObject({ groupId: a, weekStart: MONDAY, canWrite: true })
    // A facility without groups has nothing to show.
    const other = addFacility(db, 'Zweite')
    expect(errorCode(() => getGroupWeek(db, asChildViewer(addUser(db, 'leitung2', 'admin', null, other)), null, FRIDAY)))
      .toBe('group_not_found')
  })

  it('names the account of the Leitung', () => {
    setDayNote(db, leitung, a, MONDAY, 'Ausflug', NOW)
    expect(db.select().from(groupBookChanges).get()).toMatchObject({ changedByUserId: leitung.id, changedByName: 'leitung' })
  })

  it('does not log or store a change that changes nothing', () => {
    setWeekTheme(db, leitung, a, MONDAY, '', NOW)
    setDayNote(db, leitung, a, MONDAY, '', NOW)
    expect(db.select().from(groupWeekNotes).all()).toEqual([])
    expect(db.select().from(groupDayNotes).all()).toEqual([])
    setDayNote(db, leitung, a, MONDAY, 'Ausflug', NOW)
    setDayNote(db, leitung, a, MONDAY, 'Ausflug', LATER)
    expect(db.select().from(groupBookChanges).all()).toHaveLength(1)
    expect(getGroupWeek(db, leitung, a, MONDAY).days[0]!.note.updatedAt).toBe(NOW.toISOString())
    // Taking the text away is a change.
    setDayNote(db, leitung, a, MONDAY, '', LATER)
    expect(groupBookHistory(db, leitung, a, 'day', MONDAY)[0]).toMatchObject({ before: 'Ausflug', after: '' })
  })

  it('takes a theme for any day of the week as the week of its Monday', () => {
    setWeekTheme(db, leitung, a, FRIDAY, 'Herbst', NOW)
    expect(db.select().from(groupWeekNotes).get()).toMatchObject({ weekStart: MONDAY })
  })

  it('writes the days Monday to Friday only', () => {
    expect(errorCode(() => setDayNote(db, leitung, a, '2026-10-17', 'Samstag', NOW))).toBe('invalid_date')
    expect(errorCode(() => setDayNote(db, leitung, a, '2026-10-18', 'Sonntag', NOW))).toBe('invalid_date')
    expect(errorCode(() => setDayNote(db, leitung, a, '2026-02-30', 'x', NOW))).toBe('invalid_date')
    expect(db.select().from(groupDayNotes).all()).toEqual([])
    expect(errorCode(() => groupBookHistory(db, leitung, a, 'day', '2026-10-17'))).toBe('invalid_date')
  })

  it('labels holidays of the facility state and closure days, which stay writable', () => {
    db.insert(closures).values({ facilityId: 1, startDate: '2026-12-24', endDate: '2026-12-24', label: 'Heiligabend', mode: 'closure_day' }).run()
    const week = getGroupWeek(db, leitung, a, '2026-12-22')
    expect(week.weekStart).toBe('2026-12-21')
    expect(week.days.map(day => day.label)).toEqual([
      null, null, null, { kind: 'closure', label: 'Heiligabend' }, { kind: 'holiday', key: 'christmas_day' },
    ])
    expect(getGroupWeek(db, leitung, a, MONDAY).days.map(day => day.label)).toEqual([null, null, null, null, null])
    // The facility's state decides: 1 Nov 2027 (Monday) is All Saints' day in Baden-Württemberg, not in Berlin.
    expect(getGroupWeek(db, leitung, a, '2027-11-01').days[0]!.label).toEqual({ kind: 'holiday', key: 'all_saints_day' })
    db.update(facilities).set({ state: 'BE' }).where(eq(facilities.id, 1)).run()
    expect(getGroupWeek(db, leitung, a, '2027-11-01').days[0]!.label).toBeNull()
    // A labelled day takes an entry all the same.
    setDayNote(db, leitung, a, '2026-12-25', 'Feiertag im Haus', NOW)
    expect(getGroupWeek(db, leitung, a, '2026-12-25').days[4]!.note.text).toBe('Feiertag im Haus')
  })

  it('reads the groups a person may read, but writes only the own one', () => {
    setDayNote(db, leitung, b, MONDAY, 'Backen', NOW)
    const read = getGroupWeek(db, atTablet, b, MONDAY)
    expect(read).toMatchObject({ groupName: 'Mäuse', canWrite: false })
    expect(read.days[0]!.note.text).toBe('Backen')
    expect(groupBookHistory(db, atTablet, b, 'day', MONDAY)).toHaveLength(1)
    expect(errorCode(() => setDayNote(db, atTablet, b, MONDAY, 'Neu', NOW))).toBe('group_read_only')
    expect(errorCode(() => setWeekTheme(db, atTablet, b, MONDAY, 'Neu', NOW))).toBe('group_read_only')
    expect(getGroupWeek(db, leitung, b, MONDAY).days[0]!.note.text).toBe('Backen')
    expect(db.select().from(groupBookChanges).all()).toHaveLength(1)
  })

  it('hides groups without access and groups of another facility', () => {
    const other = addFacility(db, 'Zweite')
    const foreign = addGroup(db, other, 'Fremd')
    for (const who of [atTablet]) {
      expect(errorCode(() => getGroupWeek(db, who, c, MONDAY))).toBe('group_not_found')
      expect(errorCode(() => setDayNote(db, who, c, MONDAY, 'x', NOW))).toBe('group_not_found')
      expect(errorCode(() => setWeekTheme(db, who, c, MONDAY, 'x', NOW))).toBe('group_not_found')
      expect(errorCode(() => groupBookHistory(db, who, c, 'day', MONDAY))).toBe('group_not_found')
    }
    expect(errorCode(() => getGroupWeek(db, leitung, foreign, MONDAY))).toBe('group_not_found')
    expect(errorCode(() => setDayNote(db, leitung, foreign, MONDAY, 'x', NOW))).toBe('group_not_found')
    expect(errorCode(() => setWeekTheme(db, leitung, foreign, MONDAY, 'x', NOW))).toBe('group_not_found')
    expect(errorCode(() => groupBookHistory(db, leitung, foreign, 'day', MONDAY))).toBe('group_not_found')
    expect(errorCode(() => getGroupWeek(db, leitung, 9999, MONDAY))).toBe('group_not_found')
    expect(db.select().from(groupBookChanges).all()).toEqual([])
  })

  it('lets a viewer without group access write everywhere and lists only the visible groups with their right', () => {
    setDayNote(db, leitung, c, MONDAY, 'Waldtag', NOW)
    expect(getGroupWeek(db, leitung, c, MONDAY)).toMatchObject({ canWrite: true })
    expect(getGroupWeek(db, leitung, a, MONDAY).groups).toEqual([
      { id: a, name: 'Bären', right: 'write' }, { id: b, name: 'Mäuse', right: 'write' }, { id: c, name: 'Füchse', right: 'write' },
    ])
    expect(getGroupWeek(db, atTablet, a, MONDAY).groups).toEqual([
      { id: a, name: 'Bären', right: 'write' }, { id: b, name: 'Mäuse', right: 'read' },
    ])
  })

  it('names the facility for the print page', () => {
    expect(getGroupWeek(db, leitung, a, MONDAY).facilityName).toBe(
      db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, 1)).get()!.name,
    )
  })

  it('removes the notes and the history with the group', () => {
    const gone = addGroup(db, 1, 'Wichtel')
    setWeekTheme(db, leitung, gone, MONDAY, 'Herbst', NOW)
    setDayNote(db, leitung, gone, MONDAY, 'Basteln', NOW)
    setDayNote(db, leitung, a, MONDAY, 'bleibt', NOW)
    deleteGroup(db, 1, gone, '2026-10-14')
    expect(db.select().from(groupWeekNotes).all()).toEqual([])
    expect(db.select().from(groupDayNotes).all().map(row => row.groupId)).toEqual([a])
    expect(db.select().from(groupBookChanges).all().map(row => row.groupId)).toEqual([a])
  })
})
