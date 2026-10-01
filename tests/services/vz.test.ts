import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06'

describe('shifts next to VZ / Büro', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'code', codeId: codeId(db, 'prep_time'), start: 450, end: 570 })
  })
  const replace = (input: EntryInput) => applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', input)
  const labels = () => loadEntries(db, { employeeId: anna, from: date, to: date }).map(e => `${e.shortLabel ?? ''}${e.label}`)

  it('keeps VZ when a shift is entered and lets the shift start after VZ', () => {
    replace({ kind: 'shift', templateId: templateId(db, 'F2'), start: 570 })
    const entries = loadEntries(db, { employeeId: anna, from: date, to: date })
    expect(labels()).toEqual(['VZ 7:30–9:30', 'F29:30–15:45'])
    expect(entries[1]).toMatchObject({ kind: 'shift', start: 570, end: 945, breakStart: 700, breakEnd: 730 })
  })
  it('starts a clicked fixed shift right after an overlapping VZ', () => {
    replace({ kind: 'shift', templateId: templateId(db, 'S') })
    const entries = loadEntries(db, { employeeId: anna, from: date, to: date })
    expect(labels()).toEqual(['VZ 7:30–9:30', 'S9:30–17:00'])
    expect(entries[1]).toMatchObject({ breakStart: 730, breakEnd: 760 })
  })
  it('keeps VZ when a special shift is entered', () => {
    replace({ kind: 'special', start: 570, end: 870 })
    expect(labels()).toEqual(['VZ 7:30–9:30', '9:30–14:30'])
  })
  it('replaces the other shift but keeps VZ', () => {
    replace({ kind: 'shift', templateId: templateId(db, 'F2'), start: 570 })
    replace({ kind: 'shift', templateId: templateId(db, 'S'), start: 570 })
    expect(labels()).toEqual(['VZ 7:30–9:30', 'S9:30–17:00'])
  })
  it('replaces everything with a full-day code', () => {
    replace({ kind: 'code', codeId: codeId(db, 'sick') })
    expect(labels()).toEqual(['Krank'])
  })
  it('rejects manual working times that overlap each other', () => {
    expect(errorCode(() => replace({ kind: 'special', start: 480, end: 900 }))).toBe('entries_overlap')
    expect(labels()).toEqual(['VZ 7:30–9:30'])
  })
  it('validates a later shift start', () => {
    expect(errorCode(() => replace({ kind: 'shift', templateId: templateId(db, 'F2'), start: 440 }))).toBe('invalid_shift_start')
    expect(errorCode(() => replace({ kind: 'shift', templateId: templateId(db, 'F2'), start: 573 }))).toBe('invalid_shift_start')
    expect(errorCode(() => replace({ kind: 'shift', templateId: templateId(db, 'F2'), start: 945 }))).toBe('invalid_shift_start')
  })
})
