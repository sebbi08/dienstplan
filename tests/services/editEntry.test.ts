import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells, updateEntryTimes } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06'

describe('editing the times of a clicked entry', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const add = (input: EntryInput) => applyToCells(db, admin, [{ employeeId: anna, date }], 'add', input)
  const cellEntries = () => loadEntries(db, { employeeId: anna, from: date, to: date })
  const find = (kind: string) => cellEntries().find(entry => entry.kind === kind)!

  it('turns a fixed shift with changed times into a special shift', () => {
    add({ kind: 'shift', templateId: templateId(db, 'M') })
    updateEntryTimes(db, admin, find('shift').id, { start: 480, end: 960, breakStart: 700, breakEnd: 730 })
    expect(cellEntries()).toMatchObject([{ kind: 'special', templateId: null, start: 480, end: 960, breakStart: 700, breakEnd: 730, countsAsStaff: true }])
  })
  it('keeps a fixed shift when only its break changes', () => {
    add({ kind: 'shift', templateId: templateId(db, 'M') })
    updateEntryTimes(db, admin, find('shift').id, { start: 465, end: 960, breakStart: 750, breakEnd: 780 })
    expect(cellEntries()).toMatchObject([{ kind: 'shift', shortLabel: 'M', breakStart: 750, breakEnd: 780 }])
  })
  it('keeps HK a non-staff entry when it becomes a special shift', () => {
    add({ kind: 'shift', templateId: templateId(db, 'HK') })
    updateEntryTimes(db, admin, find('shift').id, { start: 660, end: 900, breakStart: null, breakEnd: null })
    expect(cellEntries()).toMatchObject([{ kind: 'special', countsAsStaff: false }])
  })
  it('changes VZ times and additional breaks', () => {
    add({ kind: 'shift', templateId: templateId(db, 'M') })
    add({ kind: 'code', codeId: codeId(db, 'prep_time'), start: 840, end: 960 })
    add({ kind: 'break', start: 900, end: 915 })
    updateEntryTimes(db, admin, find('code').id, { start: 870, end: 960, breakStart: null, breakEnd: null })
    updateEntryTimes(db, admin, find('break').id, { start: 905, end: 920, breakStart: 905, breakEnd: 910 })
    expect(find('code')).toMatchObject({ start: 870, end: 960 })
    expect(find('break')).toMatchObject({ start: 905, end: 920, breakStart: null, breakEnd: null })
  })
  it('rejects changes that break the rules of the day', () => {
    add({ kind: 'shift', templateId: templateId(db, 'F1') })
    add({ kind: 'special', start: 840, end: 960 })
    add({ kind: 'break', start: 900, end: 915 })
    const special = find('special').id
    expect(errorCode(() => updateEntryTimes(db, admin, special, { start: 780, end: 960, breakStart: null, breakEnd: null }))).toBe('entries_overlap')
    expect(errorCode(() => updateEntryTimes(db, admin, special, { start: 840, end: 900, breakStart: null, breakEnd: null }))).toBe('break_outside_work')
    expect(errorCode(() => updateEntryTimes(db, admin, special, { start: 840, end: 960, breakStart: 895, breakEnd: 905 }))).toBe('break_overlap')
    expect(errorCode(() => updateEntryTimes(db, admin, special, { start: 960, end: 840, breakStart: null, breakEnd: null }))).toBe('span_end_before_start')
    expect(errorCode(() => updateEntryTimes(db, admin, 999, { start: 840, end: 960, breakStart: null, breakEnd: null }))).toBe('entry_not_found')
    expect(find('special')).toMatchObject({ start: 840, end: 960 })
  })
  it('rejects full-day codes', () => {
    add({ kind: 'code', codeId: codeId(db, 'sick') })
    expect(errorCode(() => updateEntryTimes(db, admin, find('code').id, { start: 465, end: 960, breakStart: null, breakEnd: null }))).toBe('not_a_timed_entry')
  })
})
