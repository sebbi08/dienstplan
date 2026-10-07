import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { monthPlans } from '../../server/db/schema'
import { createClosure } from '../../server/services/closures'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { backfillSnapshots, loadReleases, releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, templateId } from '../helpers/fixtures'

describe('release snapshots', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const shift = (date: string, label: string) =>
    applyToCells(db, admin, 1, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })

  it('stores one snapshot per release with entries, notes and closure labels', () => {
    shift('2026-10-06', 'F2')
    setDayNote(db, admin, 1, '2026-10-07', 'info1', 'Elternabend')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift('2026-10-06', 'S')
    createClosure(db, admin, 1, { startDate: '2026-10-12', endDate: '2026-10-12', label: 'Teamtag', mode: 'closure_day' })
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-10-01T07:00:00Z'))

    const releases = loadReleases(db, 1, 2026, 10)
    expect(releases.map(r => [r.releasedAt, r.releasedBy])).toEqual([
      ['2026-09-25T10:00:00.000Z', 'leitung'],
      ['2026-10-01T07:00:00.000Z', 'leitung'],
    ])
    const [first, second] = releases
    expect(first!.data.employees.map(e => e.name)).toEqual(['Anna'])
    expect(first!.data.entries.map(e => e.shortLabel)).toEqual(['F2'])
    expect(first!.data.days.find(d => d.date === '2026-10-07')?.info1).toBe('Elternabend')
    expect(first!.data.days.find(d => d.date === '2026-10-12')?.closureLabel).toBeNull()
    expect(second!.data.entries.map(e => e.shortLabel ?? e.label)).toEqual(['S', 'Schließtag'])
    expect(second!.data.days.find(d => d.date === '2026-10-12')?.closureLabel).toBe('Teamtag')
  })
  it('backfills a snapshot for months released before snapshots existed', () => {
    shift('2026-10-06', 'F2')
    db.insert(monthPlans).values({ year: 2026, month: 10, releasedAt: '2026-09-25T10:00:00.000Z', releasedBy: admin.id }).run()
    expect(backfillSnapshots(db)).toBe(1)
    expect(backfillSnapshots(db)).toBe(0)
    const [release] = loadReleases(db, 1, 2026, 10)
    expect(release).toMatchObject({ releasedAt: '2026-09-25T10:00:00.000Z', releasedBy: 'leitung' })
    expect(release!.data.entries).toHaveLength(1)
  })
})
