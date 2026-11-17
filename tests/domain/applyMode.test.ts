import { describe, expect, it } from 'vitest'
import type { CodeDto } from '../../shared/types/api'
import { entryApplyMode } from '../../app/utils/applyMode'

const code = (id: number, key: CodeDto['key'], creditMode: CodeDto['creditMode'], requiresTimes: boolean, label: string = key): CodeDto => ({
  id, key, label, color: 'gray', creditMode, requiresTimes, sortOrder: id,
})
const codes: CodeDto[] = [
  code(1, 'vacation', 'daily_target', false),
  code(2, 'sick', 'daily_target', false),
  code(3, 'special_leave', 'daily_target', false),
  code(4, 'training', 'daily_target', false),
  code(5, 'closure_day', 'daily_target', false),
  code(6, 'office', 'timed', true),
  code(7, 'prep_time', 'timed', true),
  code(8, 'overtime_off', 'none', false),
  // As in the seed: „sonstiges“ credits nothing.
  code(9, 'other', 'none', false, 'sonstiges'),
]

describe('how a duty is entered into a cell', () => {
  it('adds a shift template next to what the cell holds', () => {
    expect(entryApplyMode({ kind: 'shift', templateId: 3 }, codes)).toBe('add')
  })
  it('adds a special shift', () => {
    expect(entryApplyMode({ kind: 'special', start: 480, end: 720 }, codes)).toBe('add')
  })
  it('adds a break', () => {
    expect(entryApplyMode({ kind: 'break', start: 720, end: 750 }, codes)).toBe('add')
  })
  it('adds a timed code with times (Büro, VZ)', () => {
    expect(entryApplyMode({ kind: 'code', codeId: 6, start: 480, end: 540 }, codes)).toBe('add')
    expect(entryApplyMode({ kind: 'code', codeId: 7, start: 840, end: 960 }, codes)).toBe('add')
  })
  it('replaces the cell with a full-day code (Urlaub, Krank, Sonderurlaub, Fortbildung, Schließtag)', () => {
    for (const codeId of [1, 2, 3, 4, 5]) expect(entryApplyMode({ kind: 'code', codeId }, codes)).toBe('replace')
  })
  it('replaces the cell with a full-day code even when it carries times', () => {
    expect(entryApplyMode({ kind: 'code', codeId: 4, start: 480, end: 900 }, codes)).toBe('replace')
  })
  it('replaces the cell with a code that credits nothing (ÜF, sonstiges), with or without times', () => {
    expect(entryApplyMode({ kind: 'code', codeId: 8 }, codes)).toBe('replace')
    expect(entryApplyMode({ kind: 'code', codeId: 9 }, codes)).toBe('replace')
    expect(entryApplyMode({ kind: 'code', codeId: 9, start: 480, end: 540 }, codes)).toBe('replace')
  })
  it('replaces the cell with a timed code entered without times', () => {
    expect(entryApplyMode({ kind: 'code', codeId: 6 }, codes)).toBe('replace')
    expect(entryApplyMode({ kind: 'code', codeId: 7 }, codes)).toBe('replace')
  })
  it('replaces the cell with a whole home-office day (a timed code without times, home office ticked)', () => {
    expect(entryApplyMode({ kind: 'code', codeId: 6, homeOffice: true }, codes)).toBe('replace')
  })
  it('replaces with an unknown code', () => {
    expect(entryApplyMode({ kind: 'code', codeId: 99, start: 480, end: 540 }, codes)).toBe('replace')
  })
})
