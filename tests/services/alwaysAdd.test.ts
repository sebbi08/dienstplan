import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { ServiceError } from '../../server/lib/errors'
import { applyToCells } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import type { EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

const date = '2026-10-06'

/** A second duty is always added to the cell; only a full-day absence gives way to it. */
describe('adding a duty to a cell', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const apply = (mode: 'replace' | 'add', input: EntryInput) => applyToCells(db, admin, 1, [{ employeeId: anna, date }], mode, input)
  const day = () => loadEntries(db, { employeeId: anna, from: date, to: date })
    .map(entry => [entry.kind === 'shift' ? entry.shortLabel : entry.codeKey ?? entry.kind, entry.start, entry.end])
  const office = (start: number, end: number): EntryInput => ({ kind: 'code', codeId: codeId(db, 'office'), start, end })
  const failure = (fn: () => unknown) => {
    try {
      fn()
      return null
    }
    catch (error) {
      if (error instanceof ServiceError) return { status: error.statusCode, code: error.code }
      throw error
    }
  }

  it('keeps both shifts when a second one does not overlap', () => {
    apply('add', { kind: 'shift', templateId: templateId(db, 'F1') })
    apply('add', { kind: 'special', start: 840, end: 1000 })
    expect(day()).toEqual([['F1', 420, 795], ['special', 840, 1000]])
  })

  it('refuses an overlapping second shift and changes nothing', () => {
    apply('add', { kind: 'shift', templateId: templateId(db, 'F1') })
    expect(failure(() => apply('add', { kind: 'shift', templateId: templateId(db, 'S') })))
      .toEqual({ status: 400, code: 'entries_overlap' })
    expect(day()).toEqual([['F1', 420, 795]])
  })

  it('replaces Urlaub with the shift added to the cell', () => {
    apply('replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    apply('add', { kind: 'shift', templateId: templateId(db, 'M') })
    expect(day()).toEqual([['M', 465, 960]])
  })

  it('replaces Krank with a special shift and Fortbildung with Büro added to the cell', () => {
    apply('replace', { kind: 'code', codeId: codeId(db, 'sick') })
    apply('add', { kind: 'special', start: 480, end: 720 })
    expect(day()).toEqual([['special', 480, 720]])
    apply('replace', { kind: 'code', codeId: codeId(db, 'training') })
    apply('add', office(480, 540))
    expect(day()).toEqual([['office', 480, 540]])
  })

  it('keeps Urlaub when the added duty is refused', () => {
    apply('replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    expect(failure(() => apply('add', { kind: 'special', start: 900, end: 800 }))).not.toBeNull()
    expect(day()).toEqual([['vacation', null, null]])
  })

  it('replaces a shift with Krank', () => {
    apply('add', { kind: 'shift', templateId: templateId(db, 'F2') })
    apply('add', office(960, 1020))
    apply('replace', { kind: 'code', codeId: codeId(db, 'sick') })
    expect(day()).toEqual([['sick', null, null]])
  })

  it('keeps both Büro entries when they do not overlap', () => {
    apply('add', office(480, 540))
    apply('add', office(600, 660))
    expect(day()).toEqual([['office', 480, 540], ['office', 600, 660]])
  })

  it('adds Büro inside a shift and keeps the shift', () => {
    apply('add', { kind: 'shift', templateId: templateId(db, 'M') })
    apply('add', office(480, 540))
    expect(day()).toEqual([['M', 465, 960], ['office', 480, 540]])
  })
})
