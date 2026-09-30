import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createClosure, deleteClosure, listClosures } from '../../server/services/closures'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const summer = { startDate: '2026-08-07', endDate: '2026-08-17', label: 'Sommerschließzeit', mode: 'vacation' as const }
const inRange = (db: Db) => loadEntries(db, { from: summer.startDate, to: summer.endDate })

describe('closures service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })

  it('writes the chosen code for every employee on every working day', () => {
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-08-10' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const closure = createClosure(db, admin, summer)
    const rows = inRange(db)
    expect(rows).toHaveLength(14)
    expect(rows.every(entry => entry.codeKey === 'vacation')).toBe(true)
    expect(rows.some(entry => entry.date === '2026-08-08')).toBe(false)
    expect(listClosures(db)).toEqual([closure])
    expect(getLeaveAccount(db, anna, 2026, '2026-08-01').account.planned).toBe(7)
  })
  it('uses the closure-day code in closure-day mode', () => {
    createClosure(db, admin, { ...summer, mode: 'closure_day' })
    expect(new Set(inRange(db).map(entry => entry.codeKey))).toEqual(new Set(['closure_day']))
  })
  it('keeps admin overrides when the closure is deleted', () => {
    const closure = createClosure(db, admin, summer)
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-08-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    deleteClosure(db, admin, closure.id)
    expect(inRange(db).map(entry => [entry.employeeId, entry.date, entry.label])).toEqual([[anna, '2026-08-11', '7:30–15:45']])
    expect(listClosures(db)).toEqual([])
  })
  it('suppresses warnings on closure days', () => {
    createClosure(db, admin, summer)
    applyToCells(db, admin, [{ employeeId: ben, date: '2026-08-12' }], 'clear', null)
    const warnings = getMonthPlan(db, admin, 2026, 8, '2026-08-01').admin!.warnings
    expect(warnings.filter(w => w.date === '2026-08-12')).toEqual([])
  })
  it('validates the range and label', () => {
    expect(errorCode(() => createClosure(db, admin, { ...summer, endDate: '2026-08-01' }))).toBe('invalid_range')
    expect(errorCode(() => createClosure(db, admin, { ...summer, label: ' ' }))).toBe('label_required')
    expect(errorCode(() => deleteClosure(db, admin, 999))).toBe('closure_not_found')
  })
})
