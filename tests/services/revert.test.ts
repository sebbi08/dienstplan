import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import { revertToRelease } from '../../server/services/revert'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-01'

describe('revertToRelease', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    setDayNote(db, admin, 1, '2026-10-06', 'info1', 'Elternabend')
    releaseMonth(db, admin, 1, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    // draft edits after the release
    applyToCells(db, admin, 1, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'S') })
    applyToCells(db, admin, 1, [{ employeeId: ben, date: '2026-10-07' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    setDayNote(db, admin, 1, '2026-10-06', 'info1', 'Elternabend 19 Uhr')
  })
  const pending = () => getMonthPlan(db, admin, 1, 2026, 10, today).admin!.pendingChanges

  it('restores the released entries of the selected cells only', () => {
    expect(revertToRelease(db, admin, 1, 2026, 10, [`${anna}|2026-10-06`])).toBe(1)
    expect(loadEntries(db, { employeeId: anna, from: '2026-10-06', to: '2026-10-06' })).toMatchObject([
      { kind: 'shift', shortLabel: 'F2', start: 450, end: 945, breakStart: 700, breakEnd: 730 },
    ])
    expect(Object.keys(pending()).sort()).toEqual([`${ben}|2026-10-07`, 'info1|2026-10-06'])
  })
  it('clears a cell that was empty in the release and restores info fields', () => {
    revertToRelease(db, admin, 1, 2026, 10, [`${ben}|2026-10-07`, 'info1|2026-10-06'])
    expect(loadEntries(db, { employeeId: ben, from: '2026-10-07', to: '2026-10-07' })).toEqual([])
    expect(getMonthPlan(db, admin, 1, 2026, 10, today).days[5]!.info1).toBe('Elternabend')
  })
  it('leaves no pending changes after reverting all of them', () => {
    revertToRelease(db, admin, 1, 2026, 10, Object.keys(pending()))
    expect(pending()).toEqual({})
  })
  it('validates month and keys', () => {
    expect(errorCode(() => revertToRelease(db, admin, 1, 2026, 11, [`${anna}|2026-11-02`]))).toBe('month_not_released')
    expect(errorCode(() => revertToRelease(db, admin, 1, 2026, 10, [`${anna}|2026-11-02`]))).toBe('invalid_key')
    expect(errorCode(() => revertToRelease(db, admin, 1, 2026, 10, ['info3|2026-10-06']))).toBe('invalid_key')
    expect(errorCode(() => revertToRelease(db, admin, 1, 2026, 10, ['999|2026-10-06']))).toBe('employee_not_found')
  })
})
