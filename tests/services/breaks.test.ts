import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06'

describe('breaks', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const cell = () => [{ employeeId: anna, date }]
  const cellEntries = () => loadEntries(db, { employeeId: anna, from: date, to: date })
  const shiftF2 = () => applyToCells(db, admin, 1, cell(), 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
  const addBreak = (start: number, end: number) => applyToCells(db, admin, 1, cell(), 'add', { kind: 'break', start, end })

  it('adds an additional break inside the working time', () => {
    shiftF2()
    addBreak(900, 915)
    expect(cellEntries().find(entry => entry.kind === 'break')).toMatchObject({
      start: 900, end: 915, breakStart: null, breakEnd: null, label: '[15:00–15:15]', color: 'red', countsAsStaff: false,
    })
  })
  it('rejects invalid additional breaks', () => {
    expect(errorCode(() => addBreak(900, 915))).toBe('break_outside_work')
    shiftF2()
    expect(errorCode(() => applyToCells(db, admin, 1, cell(), 'replace', { kind: 'break', start: 900, end: 915 }))).toBe('break_requires_add')
    expect(errorCode(() => addBreak(940, 960))).toBe('break_outside_work')
    expect(errorCode(() => addBreak(720, 740))).toBe('break_overlap')
    expect(errorCode(() => addBreak(900, 895))).toBe('span_end_before_start')
    expect(cellEntries()).toHaveLength(1)
  })
})
