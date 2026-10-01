import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06'

describe('full shifts around VZ / Büro', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'code', codeId: codeId(db, 'prep_time'), start: 840, end: 960 })
  })
  const apply = (mode: 'replace' | 'add', input: EntryInput) => applyToCells(db, admin, [{ employeeId: anna, date }], mode, input)
  const labels = () => loadEntries(db, { employeeId: anna, from: date, to: date }).map(e => `${e.shortLabel ?? ''}${e.label}`)

  it('enters a clicked shift with its full times around the VZ and keeps the VZ', () => {
    apply('replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const entries = loadEntries(db, { employeeId: anna, from: date, to: date })
    expect(entries.map(e => e.kind)).toEqual(['shift', 'code'])
    expect(entries[0]).toMatchObject({ start: 465, end: 960, breakStart: 700, breakEnd: 730 })
    expect(entries[1]).toMatchObject({ codeKey: 'prep_time', start: 840, end: 960 })
  })
  it('adds a full shift around the VZ in add mode (suggestion button)', () => {
    apply('add', { kind: 'shift', templateId: templateId(db, 'S') })
    expect(loadEntries(db, { employeeId: anna, from: date, to: date }).map(e => [e.kind, e.start, e.end]))
      .toEqual([['shift', 525, 1020], ['code', 840, 960]])
  })
  it('keeps VZ when a special shift is entered', () => {
    apply('replace', { kind: 'special', start: 480, end: 900 })
    expect(labels()).toHaveLength(2)
  })
  it('replaces the other shift but keeps VZ', () => {
    apply('replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    apply('replace', { kind: 'shift', templateId: templateId(db, 'S') })
    expect(loadEntries(db, { employeeId: anna, from: date, to: date }).map(e => e.shortLabel ?? e.codeKey)).toEqual(['S', 'prep_time'])
  })
  it('lets a VZ be added inside an existing shift', () => {
    apply('replace', { kind: 'shift', templateId: templateId(db, 'M') })
    apply('add', { kind: 'code', codeId: codeId(db, 'office'), start: 480, end: 540 })
    expect(loadEntries(db, { employeeId: anna, from: date, to: date })).toHaveLength(3)
  })
  it('replaces everything with a full-day code', () => {
    apply('replace', { kind: 'code', codeId: codeId(db, 'sick') })
    expect(labels()).toEqual(['Krank'])
  })
  it('rejects two working shifts that overlap each other', () => {
    apply('replace', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(errorCode(() => apply('add', { kind: 'special', start: 900, end: 1000 }))).toBe('entries_overlap')
    expect(errorCode(() => apply('add', { kind: 'shift', templateId: templateId(db, 'S') }))).toBe('entries_overlap')
  })
  it('rejects two overlapping VZ / Büro entries', () => {
    expect(errorCode(() => apply('add', { kind: 'code', codeId: codeId(db, 'office'), start: 900, end: 1000 }))).toBe('entries_overlap')
  })
})
