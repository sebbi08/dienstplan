import { asc, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { childGroupChanges, children, terminalUnlocks } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { planGroupChange } from '../../server/services/childGroupChanges'
import { runDaily } from '../../server/services/dailyRun'
import { setGroupForSchoolChildren } from '../../server/services/groups'
import { schoolLeavers, setAutoLeave } from '../../server/services/schoolChildren'
import { setPin } from '../../server/services/terminal'
import { unlockChildren } from '../../server/services/tabletUnlock'
import type { ChildActor } from '../../server/lib/childViewer'
import { addChild, addEmployee, addFacility, addGroup, addUser, asChildViewer, createTestDb } from '../helpers/fixtures'

const TODAY = '2026-10-13'
const NOW = new Date('2026-10-13T08:30:00.000Z')
const KEEP_ALL = { contacts: true, health: true, consents: true, documents: true, careType: true, keyEducator: true }
/** Born on the default cutoff (30 June, six years): the school start is 1 September 2027. */
const BORN_ON_CUTOFF = '2021-06-30'
const SCHOOL_START = '2027-09-01'
const DAY_BEFORE = '2027-08-31'

describe('the daily run', () => {
  let db: Db
  let admin: ChildActor
  let bears: number
  let mice: number
  let messages: { level: 'info' | 'error'; text: string }[]
  const log = {
    info: (...parts: unknown[]) => { messages.push({ level: 'info', text: parts.map(String).join(' ') }) },
    error: (...parts: unknown[]) => {
      messages.push({ level: 'error', text: parts.map(part => (part instanceof Error ? `${part.message} ${part.stack}` : String(part))).join(' ') })
    },
  }
  beforeEach(() => {
    db = createTestDb()
    admin = asChildViewer(addUser(db, 'leitung', 'admin'))
    bears = addGroup(db, 1, 'Bären')
    mice = addGroup(db, 1, 'Mäuse')
    messages = []
  })

  const row = (id: number) => db.select().from(children).where(eq(children.id, id)).get()
  const history = (id: number) => db.select().from(childGroupChanges).where(eq(childGroupChanges.childId, id))
    .orderBy(asc(childGroupChanges.fromDate), asc(childGroupChanges.id)).all()
    .map(entry => [entry.fromDate, entry.groupId, entry.appliedAt !== null])
  const switchOn = (facilityId = 1) => setAutoLeave(db, facilityId, true, TODAY, schoolLeavers(db, facilityId, TODAY))
  const plan = (id: number, groupId: number, date: string, newContract?: boolean) => planGroupChange(
    db, admin, 1, id, { groupId, date, keep: { ...KEEP_ALL, health: false }, ...(newContract === undefined ? {} : { newContract }) }, TODAY, NOW,
  )
  /** A change due on the school start day, a school child due that day and a record whose retention ended that day. */
  const threeDue = () => {
    const changing = addChild(db, 1, { firstName: 'Lena', lastName: 'Meier', groupId: bears })
    plan(changing, mice, SCHOOL_START)
    const schoolChild = addChild(db, 1, { firstName: 'Ole', lastName: 'Hansen', birthDate: BORN_ON_CUTOFF, groupId: bears })
    // Left on 1 September 2024: with three years of retention its record is deleted on 1 September 2027.
    const expired = addChild(db, 1, { firstName: 'Ida', lastName: 'Adler', leftOn: '2024-09-01' })
    const archived = addChild(db, 1, { firstName: 'Ben', lastName: 'Kurz', leftOn: '2024-09-02' })
    switchOn()
    return { changing, schoolChild, expired, archived }
  }

  it('applies the due group change, deregisters the school child and deletes the expired record in one run', () => {
    const { changing, schoolChild, expired, archived } = threeDue()

    expect(runDaily(db, DAY_BEFORE, log)).toEqual({ applied: 0, deregistered: 0, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 0 })
    expect(messages).toEqual([])

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 1, deregistered: 1, deleted: 1, employeeDataDeleted: 0, unlocksDeleted: 0 })

    expect(row(changing)).toMatchObject({ groupId: mice, healthReviewSince: SCHOOL_START, leftOn: null })
    expect(history(changing)).toEqual([[null, bears, true], [SCHOOL_START, mice, true]])
    expect(row(schoolChild)).toMatchObject({ leftOn: DAY_BEFORE })
    expect(row(expired)).toBeUndefined()
    expect(row(archived)).toMatchObject({ leftOn: '2024-09-02' })
  })

  it('never deletes a child in the run that deregisters it: its record stays for the retention period', () => {
    const { schoolChild } = threeDue()

    expect(runDaily(db, SCHOOL_START, log)).toMatchObject({ deregistered: 1, deleted: 1 })

    // Deregistered and still there; the one record this run deleted was the expired one.
    expect(row(schoolChild)).toMatchObject({ leftOn: DAY_BEFORE })
    // Three years from its leaving day, 31 August 2027.
    runDaily(db, '2030-08-30', log)
    expect(row(schoolChild)).toBeDefined()
    runDaily(db, '2030-08-31', log)
    expect(row(schoolChild)).toBeUndefined()
  })

  it('leaves a school child alone whose record would be deleted in the same run: it is deregistered by hand', () => {
    // School start 1 September 2023: the leaving day 31 August 2023 is past the retention period already.
    const longAgo = addChild(db, 1, { birthDate: '2017-03-01', entryDate: '2022-09-01', groupId: bears })
    switchOn()

    expect(runDaily(db, TODAY, log)).toEqual({ applied: 0, deregistered: 0, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 0 })

    expect(row(longAgo)).toMatchObject({ leftOn: null })
  })

  it('does nothing in a second run on the same day', () => {
    threeDue()
    runDaily(db, SCHOOL_START, log)
    const after = { children: db.select().from(children).all(), changes: db.select().from(childGroupChanges).all() }
    messages = []

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 0, deregistered: 0, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 0 })

    expect({ children: db.select().from(children).all(), changes: db.select().from(childGroupChanges).all() }).toEqual(after)
    expect(messages).toEqual([])
  })

  it('applies the group changes before it deregisters: a change on the school start day is still applied', () => {
    const id = addChild(db, 1, { birthDate: BORN_ON_CUTOFF, groupId: bears })
    plan(id, mice, SCHOOL_START)
    switchOn()

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 1, deregistered: 1, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 0 })

    // The other way round the leaving would have deleted the change as one after the leaving day.
    expect(history(id)).toEqual([[null, bears, true], [SCHOOL_START, mice, true]])
    expect(row(id)).toMatchObject({ groupId: mice, leftOn: DAY_BEFORE })
  })

  it('keeps a child that changes into a group for school children on its school start', () => {
    const hort = addGroup(db, 1, 'Hort')
    setGroupForSchoolChildren(db, hort, true)
    const id = addChild(db, 1, { birthDate: BORN_ON_CUTOFF, groupId: bears })
    plan(id, hort, SCHOOL_START, true)
    switchOn()

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 1, deregistered: 0, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 0 })

    expect(row(id)).toMatchObject({ groupId: hort, leftOn: null, contractReviewSince: SCHOOL_START })
  })

  it('handles every facility and deregisters only where the switch is on', () => {
    const krippe = addFacility(db, 'Krippe')
    const wichtel = addGroup(db, krippe, 'Wichtel')
    const here = addChild(db, 1, { birthDate: BORN_ON_CUTOFF, groupId: bears })
    const there = addChild(db, krippe, { birthDate: BORN_ON_CUTOFF, groupId: wichtel })
    const expiredThere = addChild(db, krippe, { leftOn: '2024-09-01' })
    switchOn()

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 0, deregistered: 1, deleted: 1, employeeDataDeleted: 0, unlocksDeleted: 0 })

    expect(row(here)).toMatchObject({ leftOn: DAY_BEFORE })
    expect(row(there)).toMatchObject({ leftOn: null })
    expect(row(expiredThere)).toBeUndefined()
  })

  it('logs the numbers only, never a name', () => {
    threeDue()

    runDaily(db, SCHOOL_START, log)

    expect(messages).toEqual([
      { level: 'info', text: 'Applied 1 group change(s).' },
      { level: 'info', text: 'Deregistered 1 school child(ren).' },
      { level: 'info', text: 'Deleted 1 child record(s) after the retention period.' },
    ])
  })

  it('does the other parts when one fails, and names nobody in the log', () => {
    const { changing, schoolChild, expired } = threeDue()
    db.run(sql.raw(`CREATE TRIGGER fail_applying BEFORE UPDATE OF applied_at ON child_group_changes
      BEGIN SELECT RAISE(ABORT, 'disk trouble'); END`))

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 0, deregistered: 1, deleted: 1, employeeDataDeleted: 0, unlocksDeleted: 0 })

    // Nothing of the failed part is written; the other two are done.
    expect(row(changing)).toMatchObject({ groupId: bears, healthReviewSince: null })
    expect(history(changing)).toEqual([[null, bears, true], [SCHOOL_START, mice, false]])
    expect(row(schoolChild)).toMatchObject({ leftOn: DAY_BEFORE })
    expect(row(expired)).toBeUndefined()
    const errors = messages.filter(message => message.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.text).toContain('Applying planned group changes failed')
    for (const name of ['Lena', 'Meier', 'Ole', 'Hansen', 'Ida', 'Adler']) {
      for (const message of messages) expect(message.text).not.toContain(name)
    }

    // Once the trouble is over, the next run catches up.
    db.run(sql.raw('DROP TRIGGER fail_applying'))
    expect(runDaily(db, '2027-09-02', log)).toMatchObject({ applied: 1, deregistered: 0 })
    expect(row(changing)).toMatchObject({ groupId: mice, healthReviewSince: SCHOOL_START })
  })

  it('deletes the data of left employees once a day and logs the numbers per category, never a name', () => {
    const tina = addEmployee(db, 'Tina Test', { leftOn: '2026-03-15' })
    addUser(db, 'tina', 'observer', tina)

    const result = runDaily(db, '2026-03-16', log)

    // Her account (her weekly hours stay with the time data).
    expect(result.employeeDataDeleted).toBe(1)
    expect(messages).toEqual([{
      level: 'info',
      text: 'Deleted data of left employees after the retention periods: 1 immediately, 0 time data, 0 assessments, '
        + '0 paid overtime, 0 employee record(s).',
    }])
    // The hourly tries of the same day leave it alone; the next day runs again.
    db.run(sql.raw(`UPDATE employees SET birthday = '04-12' WHERE id = ${tina}`))
    expect(runDaily(db, '2026-03-16', log).employeeDataDeleted).toBe(0)
    expect(runDaily(db, '2026-03-17', log).employeeDataDeleted).toBe(1)
    expect(messages.map(message => message.text).join(' ')).not.toContain('Tina')
  })

  describe('tablet unlocks', () => {
    const unlockAt = (now: Date) => {
      const employeeId = addEmployee(db, 'Anna')
      setTimeTrackingFrom(db, 1, '2026-10-01')
      setPin(db, 1, employeeId, '123456')
      const tablet = addUser(db, 'tablet', 'terminal')
      unlockChildren(db, { id: tablet.id, facilityId: 1 }, employeeId, '123456', now)
    }

    it('deletes expired tablet unlocks and keeps the others', () => {
      unlockAt(new Date('2026-10-13T08:00:00.000Z'))

      // Lock time 2 minutes plus 30 seconds of grace.
      expect(runDaily(db, TODAY, log, new Date('2026-10-13T08:02:00.000Z'))).toMatchObject({ unlocksDeleted: 0 })
      expect(db.select().from(terminalUnlocks).all()).toHaveLength(1)
      expect(runDaily(db, TODAY, log, new Date('2026-10-13T08:03:00.000Z'))).toEqual({ applied: 0, deregistered: 0, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 1 })
      expect(db.select().from(terminalUnlocks).all()).toEqual([])
      expect(messages).toEqual([{ level: 'info', text: 'Deleted 1 expired tablet unlock(s).' }])
    })

    it('still does the other parts when deleting unlocks fails', () => {
      unlockAt(new Date('2026-10-13T08:00:00.000Z'))
      const { expired } = threeDue()
      db.run(sql.raw(`CREATE TRIGGER fail_unlocks BEFORE DELETE ON terminal_unlocks
        BEGIN SELECT RAISE(ABORT, 'disk trouble'); END`))
      messages = []

      expect(runDaily(db, SCHOOL_START, log, new Date('2027-09-01T08:00:00.000Z'))).toEqual({ applied: 1, deregistered: 1, deleted: 1, employeeDataDeleted: 0, unlocksDeleted: 0 })

      expect(row(expired)).toBeUndefined()
      expect(db.select().from(terminalUnlocks).all()).toHaveLength(1)
      expect(messages.filter(message => message.level === 'error').map(message => message.text.includes('Deleting expired tablet unlocks failed')))
        .toEqual([true])
    })
  })

  it('still applies and deregisters when deleting fails, and tries deleting again in the next run', () => {
    const { changing, schoolChild, expired } = threeDue()
    db.run(sql.raw(`CREATE TRIGGER fail_deleting BEFORE DELETE ON children
      BEGIN SELECT RAISE(ABORT, 'disk trouble'); END`))

    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 1, deregistered: 1, deleted: 0, employeeDataDeleted: 0, unlocksDeleted: 0 })

    expect(row(changing)).toMatchObject({ groupId: mice })
    expect(row(schoolChild)).toMatchObject({ leftOn: DAY_BEFORE })
    expect(row(expired)).toBeDefined()
    expect(messages.filter(message => message.level === 'error').map(message => message.text.includes('Deleting expired child records failed')))
      .toEqual([true])

    db.run(sql.raw('DROP TRIGGER fail_deleting'))
    expect(runDaily(db, SCHOOL_START, log)).toEqual({ applied: 0, deregistered: 0, deleted: 1, employeeDataDeleted: 0, unlocksDeleted: 0 })
    expect(row(expired)).toBeUndefined()
  })
})
