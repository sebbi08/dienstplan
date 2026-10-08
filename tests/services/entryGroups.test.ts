import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog, entries, releaseSnapshots, shiftTemplates } from '../../server/db/schema'
import { adoptShiftTimes, applyToCells, setEntryGroup, updateEntryTimes } from '../../server/services/entries'
import { deleteGroup } from '../../server/services/groups'
import { listNotifications } from '../../server/services/notifications'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import { buildSnapshot, releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import { cellKey } from '../../shared/domain/cells'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addHelpOut, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const tuesday = '2026-10-06'
const today = '2026-10-01'

describe('entry groups (single duties in another group)', () => {
  let db: Db
  let admin: SessionUser
  let kaefer: number
  let maeuse: number
  let anna: number
  let ben: number

  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    kaefer = addGroup(db, 1, 'Käfer')
    maeuse = addGroup(db, 1, 'Mäuse')
    anna = addEmployee(db, 'Anna', { groupId: kaefer })
    ben = addEmployee(db, 'Ben')
    addUser(db, 'anna', 'observer', anna)
  })

  const shift = (label = 'F2', extra: Partial<EntryInput> = {}): EntryInput =>
    ({ kind: 'shift', templateId: templateId(db, label), ...extra })
  const write = (employeeId: number, input: EntryInput, date = tuesday) =>
    applyToCells(db, admin, 1, [{ employeeId, date }], 'replace', input)
  const day = (employeeId: number, date = tuesday) => loadEntries(db, { employeeId, from: date, to: date })
  const entryOf = (employeeId: number, date = tuesday) => day(employeeId, date).find(entry => entry.kind === 'shift')!.id
  const pending = () => getMonthPlan(db, admin, 1, 2026, 10, today).admin!.pendingChanges
  const release = (iso: string) => releaseMonth(db, admin, 1, 2026, 10, new Date(iso))

  it('sets and clears the group of an entry', () => {
    write(anna, shift())
    expect(day(anna)[0]!.groupId).toBeNull()
    setEntryGroup(db, admin, 1, entryOf(anna), maeuse)
    expect(day(anna)[0]!.groupId).toBe(maeuse)
    setEntryGroup(db, admin, 1, entryOf(anna), null)
    expect(day(anna)[0]!.groupId).toBeNull()
  })

  it('logs a group change of a released month with the group name', () => {
    write(anna, shift())
    release('2026-09-25T10:00:00Z')
    setEntryGroup(db, admin, 1, entryOf(anna), maeuse)
    const log = db.select().from(changeLog).all()
    expect(log.map(row => [row.employeeId, row.before, row.after])).toEqual([
      [anna, 'F2 7:30–15:45 [11:40–12:10]', 'F2 7:30–15:45 [11:40–12:10] → Mäuse'],
    ])
    setEntryGroup(db, admin, 1, entryOf(anna), maeuse) // no change, nothing logged
    expect(db.select().from(changeLog).all()).toHaveLength(1)
  })

  it('refuses a group or an entry of another facility with 404, changing nothing', () => {
    const krippe = addFacility(db, 'Krippe')
    const raupen = addGroup(db, krippe, 'Raupen')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    const leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
    write(anna, shift())
    applyToCells(db, leitungB, krippe, [{ employeeId: kim, date: tuesday }], 'replace',
      { kind: 'shift', templateId: templateId(db, 'F2', krippe) })
    expect(errorCode(() => setEntryGroup(db, admin, 1, entryOf(anna), raupen))).toBe('group_not_found')
    expect(errorCode(() => setEntryGroup(db, admin, 1, entryOf(kim), maeuse))).toBe('entry_not_found')
    expect(errorCode(() => setEntryGroup(db, admin, 1, entryOf(kim), null))).toBe('entry_not_found')
    expect(errorCode(() => setEntryGroup(db, admin, 1, 99999, maeuse))).toBe('entry_not_found')
    expect(errorCode(() => write(ben, shift('F2', { groupId: raupen }), '2026-10-07'))).toBe('group_not_found')
    expect(day(anna)[0]!.groupId).toBeNull()
    expect(day(kim)[0]!.groupId).toBeNull()
    expect(day(ben, '2026-10-07')).toEqual([])
  })

  it('writes the group given with a cell, and none for range entries without one', () => {
    write(ben, shift('F2', { groupId: maeuse }))
    expect(day(ben)[0]!.groupId).toBe(maeuse)
    // Rewriting the cell with the group of the dialog keeps it; a range entry (no group) uses the home group.
    write(ben, shift('S', { groupId: maeuse }))
    expect(day(ben)[0]).toMatchObject({ shortLabel: 'S', groupId: maeuse })
    applyToCells(db, admin, 1, [{ employeeId: ben, date: tuesday }, { employeeId: anna, date: tuesday }], 'replace', shift('M'))
    expect([day(ben)[0]!.groupId, day(anna)[0]!.groupId]).toEqual([null, null])
  })

  it('stores the own home group as none, so the duty follows later home-group changes (Ruling 4)', () => {
    write(anna, shift('F2', { groupId: kaefer }))
    expect(day(anna)[0]!.groupId).toBeNull()
    setEntryGroup(db, admin, 1, entryOf(anna), maeuse)
    expect(day(anna)[0]!.groupId).toBe(maeuse)
    setEntryGroup(db, admin, 1, entryOf(anna), kaefer)
    expect(day(anna)[0]!.groupId).toBeNull()
    // Several cells at once: each person's own home group is none, another group stays.
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-07' }, { employeeId: ben, date: '2026-10-07' }], 'replace',
      shift('M', { groupId: kaefer }))
    expect([day(anna, '2026-10-07')[0]!.groupId, day(ben, '2026-10-07')[0]!.groupId]).toEqual([null, kaefer])
  })

  it('gives absences and breaks no group (Ruling 5)', () => {
    const sick: EntryInput = { kind: 'code', codeId: codeId(db, 'sick'), groupId: maeuse }
    write(anna, sick)
    expect(day(anna)[0]).toMatchObject({ codeKey: 'sick', groupId: null })
    expect(errorCode(() => setEntryGroup(db, admin, 1, day(anna)[0]!.id, maeuse))).toBe('group_not_allowed')
    setEntryGroup(db, admin, 1, day(anna)[0]!.id, null)
    expect(day(anna)[0]!.groupId).toBeNull()

    write(ben, shift('F2', { groupId: maeuse }), '2026-10-07')
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-10-07' }], 'add',
      { kind: 'break', start: 600, end: 615, groupId: maeuse })
    const pause = day(ben, '2026-10-07').find(entry => entry.kind === 'break')!
    expect(pause.groupId).toBeNull()
    expect(errorCode(() => setEntryGroup(db, admin, 1, pause.id, kaefer))).toBe('group_not_allowed')
    expect(day(ben, '2026-10-07').find(entry => entry.kind === 'shift')!.groupId).toBe(maeuse)

    // VZ and Büro are working duties and may count for a group.
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-10-08' }], 'replace',
      { kind: 'code', codeId: codeId(db, 'office'), start: 480, end: 600 })
    const office = day(ben, '2026-10-08')[0]!
    setEntryGroup(db, admin, 1, office.id, kaefer)
    expect(day(ben, '2026-10-08')[0]!.groupId).toBe(kaefer)
  })

  it('keeps the group when times change, a service adopts new times or VZ stays next to a new shift', () => {
    write(anna, shift('F2', { groupId: maeuse }))
    updateEntryTimes(db, admin, 1, entryOf(anna), { start: 480, end: 945, breakStart: 700, breakEnd: 730 })
    expect(day(anna)[0]).toMatchObject({ kind: 'special', start: 480, groupId: maeuse })

    write(anna, shift('F2', { groupId: maeuse }), '2026-10-07')
    const f2 = db.select().from(shiftTemplates).where(eq(shiftTemplates.id, templateId(db, 'F2'))).get()!
    const oldTimes = { start: f2.start, end: f2.end, breakStart: f2.breakStart, breakEnd: f2.breakEnd }
    expect(adoptShiftTimes(db, admin, 1, f2.id, oldTimes, { ...oldTimes, start: f2.start + 15 }, '2026-10-01'))
      .toEqual({ updated: 1, skipped: 0 })
    expect(day(anna, '2026-10-07')[0]).toMatchObject({ start: f2.start + 15, groupId: maeuse })

    applyToCells(db, admin, 1, [{ employeeId: ben, date: tuesday }], 'replace',
      { kind: 'code', codeId: codeId(db, 'prep_time'), start: 960, end: 1020, groupId: maeuse })
    write(ben, shift('F2'))
    expect(day(ben).map(entry => [entry.codeKey ?? entry.shortLabel, entry.groupId])).toEqual([['F2', null], ['prep_time', maeuse]])
  })

  it('makes a group change a pending change and tells the person on re-release', () => {
    write(anna, shift())
    write(ben, shift('S'))
    release('2026-09-25T10:00:00Z')
    setEntryGroup(db, admin, 1, entryOf(anna), maeuse)
    expect(pending()).toEqual({
      [cellKey(anna, tuesday)]: { before: 'F2 7:30–15:45 [11:40–12:10]', after: 'F2 7:30–15:45 [11:40–12:10] → Mäuse' },
    })
    expect(release('2026-10-01T08:00:00Z')).toEqual({ notified: ['Anna'] })
    const [message] = listNotifications(db, anna, new Date('2026-10-01T09:00:00Z'))
    expect(message!.changes).toEqual([
      { date: tuesday, before: 'F2 7:30–15:45 [11:40–12:10]', after: 'F2 7:30–15:45 [11:40–12:10] → Mäuse' },
    ])
    expect(pending()).toEqual({})
  })

  it('restores the released group on revert, and none for a group deleted since', () => {
    write(anna, shift('F2', { groupId: maeuse }))
    write(ben, shift('S', { groupId: kaefer }))
    release('2026-09-25T10:00:00Z')
    setEntryGroup(db, admin, 1, entryOf(anna), null)
    setEntryGroup(db, admin, 1, entryOf(ben), null)
    expect(revertToRelease(db, admin, 1, 2026, 10, [cellKey(anna, tuesday)])).toBe(1)
    expect(day(anna)[0]!.groupId).toBe(maeuse)
    expect(Object.keys(pending())).toEqual([cellKey(ben, tuesday)])

    // Mäuse is deleted after the release (Anna's duty counts for her home group again); reverting cannot bring it back.
    deleteGroup(db, 1, maeuse)
    expect(day(anna)[0]!.groupId).toBeNull()
    revertToRelease(db, admin, 1, 2026, 10, [cellKey(anna, tuesday)])
    expect(day(anna)[0]).toMatchObject({ shortLabel: 'F2', groupId: null })
  })

  it('reads old snapshots without groupId as no group: no pending change and nobody told (Review Focus 1)', () => {
    write(anna, shift())
    write(ben, shift('S'))
    release('2026-09-25T10:00:00Z')
    // A snapshot stored before groups existed has no groups and no groupId on its employees and entries.
    for (const row of db.select().from(releaseSnapshots).all()) {
      const data = JSON.parse(row.data) as { groups?: unknown; employees: Record<string, unknown>[]; entries: Record<string, unknown>[] }
      delete data.groups
      for (const employee of data.employees) delete employee.groupId
      for (const entry of data.entries) delete entry.groupId
      db.update(releaseSnapshots).set({ data: JSON.stringify(data) }).where(eq(releaseSnapshots.id, row.id)).run()
    }
    expect(db.select().from(releaseSnapshots).get()!.data).not.toContain('groupId')
    expect(pending()).toEqual({})
    expect(release('2026-10-01T08:00:00Z')).toEqual({ notified: [] })
  })

  describe('helpers', () => {
    let krippe: number
    let raupen: number
    let leitungB: SessionUser

    beforeEach(() => {
      krippe = addFacility(db, 'Krippe')
      raupen = addGroup(db, krippe, 'Raupen')
      leitungB = addUser(db, 'leitung-b', 'admin', null, krippe)
      addHelpOut(db, anna, krippe, 2026, 10)
    })
    const writeInB = (input: EntryInput) => applyToCells(db, leitungB, krippe, [{ employeeId: anna, date: tuesday }], 'replace', input)
    const shiftInB = (extra: Partial<EntryInput> = {}): EntryInput =>
      ({ kind: 'shift', templateId: templateId(db, 'F2', krippe), ...extra })

    it('checks a helper cell\'s group against the plan it is written in, never the home facility', () => {
      expect(errorCode(() => writeInB(shiftInB({ groupId: maeuse })))).toBe('group_not_found')
      writeInB(shiftInB({ groupId: raupen }))
      expect(day(anna)[0]).toMatchObject({ helpFacilityId: krippe, groupId: raupen })
      const id = entryOf(anna)
      expect(errorCode(() => setEntryGroup(db, leitungB, krippe, id, kaefer))).toBe('group_not_found')
      setEntryGroup(db, leitungB, krippe, id, null)
      expect(day(anna)[0]!.groupId).toBeNull()
      setEntryGroup(db, leitungB, krippe, id, raupen)
      // The home facility cannot change the help-out entry.
      expect(errorCode(() => setEntryGroup(db, admin, 1, id, maeuse))).toBe('entry_not_found')
      expect(day(anna)[0]!.groupId).toBe(raupen)
    })

    it('shows the help-out in the home plan as a plain marker without the other plan\'s group', () => {
      writeInB(shiftInB({ groupId: raupen }))
      const marker = buildSnapshot(db, 1, 2026, 10).entries.find(entry => entry.employeeId === anna)!
      expect(marker).toMatchObject({ helpFacilityId: krippe, groupId: null })
      const inB = buildSnapshot(db, krippe, 2026, 10).entries.find(entry => entry.employeeId === anna)!
      expect(inB).toMatchObject({ helpFacilityId: krippe, groupId: raupen })
      expect(db.select().from(entries).where(and(eq(entries.employeeId, anna), eq(entries.groupId, raupen))).all()).toHaveLength(1)
    })
  })
})
