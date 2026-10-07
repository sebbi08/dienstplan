import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { listNotifications, markNotificationsRead, releaseNotificationStatus } from '../../server/services/notifications'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, templateId } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso)

describe('messages about changed duties', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let berta: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    addUser(db, 'anna', 'observer', anna)
  })
  const shift = (employeeId: number, date: string, label: string) =>
    applyToCells(db, admin, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })

  it('tells only the people whose own duties changed since the last release', () => {
    shift(anna, '2026-11-02', 'F1')
    shift(berta, '2026-11-02', 'S')
    expect(releaseMonth(db, admin, 2026, 11, at('2026-10-20T08:00:00Z'))).toEqual({ notified: [] }) // first release
    shift(anna, '2026-11-02', 'F2')
    shift(anna, '2026-11-03', 'M')
    setDayNote(db, admin, '2026-11-02', 'info1', 'Elternabend') // not a personal change
    expect(releaseMonth(db, admin, 2026, 11, at('2026-10-21T08:00:00Z'))).toEqual({ notified: ['Anna'] })

    const [message] = listNotifications(db, anna, at('2026-10-21T09:00:00Z'))
    expect(message).toMatchObject({ year: 2026, month: 11, readAt: null, createdAt: '2026-10-21T08:00:00.000Z' })
    expect(message!.changes.map(change => [change.date, change.before, change.after])).toEqual([
      ['2026-11-02', 'F1 7:00–13:15', 'F2 7:30–15:45 [11:40–12:10]'],
      ['2026-11-03', '—', 'M 7:45–16:00 [11:40–12:10]'],
    ])
    expect(listNotifications(db, berta)).toEqual([])
  })
  it('marks messages as read, keeps them two weeks and reports the status to the Leitung', () => {
    shift(anna, '2026-11-02', 'F1')
    shift(berta, '2026-11-02', 'S')
    releaseMonth(db, admin, 2026, 11, at('2026-10-20T08:00:00Z'))
    shift(anna, '2026-11-02', 'F2')
    shift(berta, '2026-11-02', 'M')
    releaseMonth(db, admin, 2026, 11, at('2026-10-21T08:00:00Z'))
    expect(releaseNotificationStatus(db, 2026, 11)).toEqual([
      { employeeId: anna, name: 'Anna', readAt: null, hasAccount: true },
      { employeeId: berta, name: 'Berta', readAt: null, hasAccount: false },
    ])

    const [message] = listNotifications(db, anna)
    markNotificationsRead(db, berta, [message!.id], at('2026-10-21T10:00:00Z')) // someone else's id: ignored
    expect(listNotifications(db, anna)[0]!.readAt).toBeNull()
    markNotificationsRead(db, anna, [message!.id], at('2026-10-21T10:00:00Z'))
    expect(releaseNotificationStatus(db, 2026, 11)[0]!.readAt).toBe('2026-10-21T10:00:00.000Z')
    expect(listNotifications(db, anna, at('2026-11-01T10:00:00Z'))).toHaveLength(1)
    expect(listNotifications(db, anna, at('2026-11-06T10:00:00Z'))).toEqual([]) // read more than 14 days ago

    releaseMonth(db, admin, 2026, 11, at('2026-10-22T08:00:00Z')) // nothing changed
    expect(releaseNotificationStatus(db, 2026, 11)).toEqual([])
  })
})
