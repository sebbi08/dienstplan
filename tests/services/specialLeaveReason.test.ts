import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { entries } from '../../server/db/schema'
import { getStaffYearCalendar } from '../../server/services/calendar'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount, getLeaveOverview } from '../../server/services/leave'
import { enterLeave, removeLeave } from '../../server/services/leaveEntries'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-11-19'
const now = new Date('2026-11-19T10:00:00Z')

let db: Db
let leitung: SessionUser
let anna: number
beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin')
  anna = addEmployee(db, 'Anna')
})

const special = (from: string, to: string, specialLeaveReason: string | null, specialLeaveText: string | null = null) =>
  enterLeave(db, leitung, 1, anna, { from, to, kind: 'special_leave', overwrite: false, specialLeaveReason, specialLeaveText }, now)
const stored = () => db.select({ date: entries.date, reason: entries.specialLeaveReason, text: entries.specialLeaveText })
  .from(entries).where(eq(entries.employeeId, anna)).all()

describe('Sonderurlaub with its reason', () => {
  it('stores key and text on the entries from „Urlaub eintragen“ and from the plan', () => {
    special('2026-11-16', '2026-11-17', 'death', '  Vater ')
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-20' }], 'replace', {
      kind: 'code', codeId: codeId(db, 'special_leave'), specialLeaveReason: 'move', specialLeaveText: null,
    })
    expect(stored()).toEqual([
      { date: '2026-11-16', reason: 'death', text: 'Vater' },
      { date: '2026-11-17', reason: 'death', text: 'Vater' },
      { date: '2026-11-20', reason: 'move', text: null },
    ])
  })

  it('checks the reason: „Sonstiges“ needs a text, unknown keys are refused; other codes ignore it', () => {
    expect(errorCode(() => special('2026-11-16', '2026-11-16', 'other', ' '))).toBe('special_leave_text_required')
    expect(errorCode(() => special('2026-11-16', '2026-11-16', 'wedding'))).toBe('special_leave_reason_invalid')
    expect(errorCode(() => applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-16' }], 'replace', {
      kind: 'code', codeId: codeId(db, 'special_leave'), specialLeaveReason: 'other', specialLeaveText: 'x'.repeat(201),
    }))).toBe('special_leave_text_too_long')
    expect(stored()).toEqual([])
    applyToCells(db, leitung, 1, [{ employeeId: anna, date: '2026-11-16' }], 'replace', {
      kind: 'code', codeId: codeId(db, 'sick'), specialLeaveReason: 'move', specialLeaveText: 'egal',
    })
    enterLeave(db, leitung, 1, anna, { from: '2026-11-17', to: '2026-11-17', kind: 'vacation', overwrite: false, specialLeaveReason: 'move' }, now)
    expect(stored()).toEqual([{ date: '2026-11-16', reason: null, text: null }, { date: '2026-11-17', reason: null, text: null }])
  })

  it('lists each period with its reason for Leitung/Träger and the employee, and „Entfernen“ removes it', () => {
    special('2026-11-16', '2026-11-16', 'birth')
    special('2026-11-17', '2026-11-18', 'other', 'Hochzeit')
    special('2026-11-19', '2026-11-19', null)
    const ranges = getLeaveAccount(db, anna, 2026, today).entryRanges
    expect(ranges).toEqual([
      { kind: 'special_leave', from: '2026-11-16', to: '2026-11-16', days: 1, reason: { key: 'birth', text: null } },
      { kind: 'special_leave', from: '2026-11-17', to: '2026-11-18', days: 2, reason: { key: 'other', text: 'Hochzeit' } },
      { kind: 'special_leave', from: '2026-11-19', to: '2026-11-19', days: 1, reason: { key: null, text: null } },
    ])
    expect(getLeaveOverview(db, 1, 2026, today, true).find(row => row.employeeId === anna)!.entryRanges).toEqual(ranges)
    expect(removeLeave(db, leitung, 1, anna, { from: '2026-11-17', to: '2026-11-18', kind: 'special_leave' }, now)).toEqual({ removed: 2, keptClosureDays: 0 })
    expect(stored().map(row => row.date)).toEqual(['2026-11-16', '2026-11-19'])
  })

  it('never shows the reason without the right, in the plan, to colleagues or at the tablet', () => {
    special('2026-11-16', '2026-11-17', 'other', 'Geheimer Grund')
    // The leave overview without the right of the sick days: periods only, without reason, one per stretch of days.
    const withoutReasons = getLeaveOverview(db, 1, 2026, today, false).find(row => row.employeeId === anna)!.entryRanges
    expect(withoutReasons).toEqual([{ kind: 'special_leave', from: '2026-11-16', to: '2026-11-17', days: 2 }])
    // The plan (draft and released) and the colleagues' plan only say „Sonderurlaub“.
    const plan = getMonthPlan(db, leitung, 1, 2026, 11, today)
    expect(plan.entries.filter(entry => entry.employeeId === anna).map(entry => entry.label)).toEqual(['Sonderurlaub', 'Sonderurlaub'])
    expect(JSON.stringify(plan)).not.toMatch(/Geheimer Grund|specialLeave/)
    releaseMonth(db, leitung, 1, 2026, 11, now)
    const ben = addEmployee(db, 'Ben')
    const colleague = addUser(db, 'ben', 'observer', ben)
    expect(JSON.stringify(getMonthPlan(db, colleague, 1, 2026, 11, today))).not.toMatch(/Geheimer Grund|specialLeave/)
    expect(JSON.stringify(getMyPlan(db, colleague, 2026, 11, today))).not.toMatch(/Geheimer Grund|specialLeave/)
    const terminal = addUser(db, 'tablet', 'terminal')
    expect(JSON.stringify(getMonthPlan(db, terminal, 1, 2026, 11, today))).not.toMatch(/Geheimer Grund|specialLeave/)
    expect(JSON.stringify(getStaffYearCalendar(db, 1, 2026, ben))).not.toMatch(/Geheimer Grund|specialLeave/)
  })
})
