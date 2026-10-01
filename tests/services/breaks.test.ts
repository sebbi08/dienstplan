import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells, updateEntryBreak } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

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
  const shiftF2 = () => applyToCells(db, admin, cell(), 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
  const addBreak = (start: number, end: number) => applyToCells(db, admin, cell(), 'add', { kind: 'break', start, end })

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
    expect(errorCode(() => applyToCells(db, admin, cell(), 'replace', { kind: 'break', start: 900, end: 915 }))).toBe('break_requires_add')
    expect(errorCode(() => addBreak(940, 960))).toBe('break_outside_work')
    expect(errorCode(() => addBreak(720, 740))).toBe('break_overlap')
    expect(errorCode(() => addBreak(900, 895))).toBe('span_end_before_start')
    expect(cellEntries()).toHaveLength(1)
  })
  it('changes the break of an entry and keeps the shift', () => {
    shiftF2()
    const [entry] = cellEntries()
    updateEntryBreak(db, admin, entry!.id, 750, 780)
    expect(cellEntries()[0]).toMatchObject({ shortLabel: 'F2', start: 450, end: 945, breakStart: 750, breakEnd: 780 })
    updateEntryBreak(db, admin, entry!.id, null, null)
    expect(cellEntries()[0]).toMatchObject({ breakStart: null, breakEnd: null })
  })
  it('rejects invalid break changes', () => {
    shiftF2()
    const [entry] = cellEntries()
    addBreak(900, 915)
    expect(errorCode(() => updateEntryBreak(db, admin, entry!.id, 420, 450))).toBe('span_break_outside')
    expect(errorCode(() => updateEntryBreak(db, admin, entry!.id, 750, null))).toBe('span_incomplete_break')
    expect(errorCode(() => updateEntryBreak(db, admin, entry!.id, 895, 925))).toBe('break_overlap')
    expect(errorCode(() => updateEntryBreak(db, admin, 999, 750, 780))).toBe('entry_not_found')
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    const sick = loadEntries(db, { employeeId: anna, from: '2026-10-07', to: '2026-10-07' })[0]!
    expect(errorCode(() => updateEntryBreak(db, admin, sick.id, 750, 780))).toBe('not_a_work_entry')
    const extra = cellEntries().find(e => e.kind === 'break')!
    expect(errorCode(() => updateEntryBreak(db, admin, extra.id, 750, 780))).toBe('not_a_work_entry')
  })
})
