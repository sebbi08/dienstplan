import { describe, expect, it } from 'vitest'
import {
  dueMonthYear, forfeitText, levelText, levelToTake, levelTone, probationText, requirementBadge, requirementBadges,
} from '../../app/utils/employeeExtras'
import { attendanceLink } from '../../app/utils/eventRequirements'

describe('the texts of the employee list columns', () => {
  it('shows „in Probezeit bis …“ only while the server sends the day (a running probation period)', () => {
    expect(probationText({ probationUntil: '2027-02-28' })).toBe('in Probezeit bis 28.02.')
    expect(probationText({ probationUntil: null })).toBeNull()
    expect(probationText({})).toBeNull()
    expect(probationText(undefined)).toBeNull()
  })

  const next = (state: 'later' | 'soon' | 'overdue', shiftDays = 0) => ({ final: false as const, fromLevel: 3, level: 4, on: '2027-02-01', state, shiftDays })

  it('names the next level with its day, or the top level', () => {
    expect(levelText(next('later'))).toBe('Stufe 4 ab 01.02.2027')
    expect(levelText({ final: true })).toBe('Endstufe')
    // Moved by Elternzeit (§ 17 Abs. 3 TVöD).
    expect(levelText(next('later', 30))).toBe('Stufe 4 ab 01.02.2027 (30 Tage später wegen Elternzeit)')
  })
  it('is amber within a month, red when overdue, plain otherwise; „übernehmen“ only then', () => {
    expect([levelTone(next('later')), levelTone(next('soon')), levelTone(next('overdue')), levelTone({ final: true })])
      .toEqual(['neutral', 'warning', 'error', 'neutral'])
    expect([levelToTake(next('later')), levelToTake(next('soon')), levelToTake(next('overdue')), levelToTake({ final: true })])
      .toEqual([null, 4, 4, null])
  })
  it('writes an appointment by its state: overdue and missing red, soon amber with the month', () => {
    expect(dueMonthYear('2026-12-20')).toBe('12.2026')
    expect(requirementBadge({ typeId: 1, typeName: 'Betriebsarzt', state: 'overdue', dueOn: '2026-01-10' }))
      .toEqual({ text: 'Betriebsarzt überfällig', tone: 'error' })
    expect(requirementBadge({ typeId: 4, typeName: 'Masernimpfung (Nachweis)', state: 'missing', dueOn: null }))
      .toEqual({ text: 'Masernimpfung (Nachweis) fehlt', tone: 'error' })
    expect(requirementBadge({ typeId: 2, typeName: 'Erste-Hilfe-Kurs', state: 'soon', dueOn: '2026-12-20' }))
      .toEqual({ text: 'Erste-Hilfe-Kurs bis 12.2026', tone: 'warning' })
  })
  it('adds „geplant am …“ of a Pflichttermin appointment ahead, also to a kind that is not open', () => {
    const planned = [
      { eventId: 7, date: '2026-12-03', endDate: null, typeId: 2, typeName: 'Erste-Hilfe-Kurs' },
      { eventId: 8, date: '2027-01-11', endDate: '2027-01-12', typeId: 5, typeName: 'Belehrung' },
    ]
    expect(requirementBadges({ requirements: [{ typeId: 2, typeName: 'Erste-Hilfe-Kurs', state: 'overdue', dueOn: '2026-10-01' }], plannedRequirements: planned }))
      .toEqual([
        { key: 2, text: 'Erste-Hilfe-Kurs überfällig · geplant am 03.12.2026', tone: 'error' },
        { key: 5, text: 'Belehrung geplant vom 11.01.2027 bis 12.01.2027', tone: 'info' },
      ])
    expect(requirementBadges({ requirements: [] })).toEqual([])
    expect(attendanceLink({ eventId: 7, year: 2026 })).toBe('/admin/calendar?year=2026&attendance=7')
  })
  it('words the leave notice, nothing outside the window', () => {
    expect(forfeitText(undefined, 2026)).toBeNull()
    expect(forfeitText(null, 2026)).toBeNull()
    expect(forfeitText({ year: 2026, status: 'read', readAt: '2026-11-19T10:00:00Z' }, 2026)).toBe('Hinweis gelesen am 19.11.2026')
    expect(forfeitText({ year: 2026, status: 'open', readAt: null }, 2026)).toBe('Hinweis offen')
    expect(forfeitText({ year: 2026, status: 'no_account', readAt: null }, 2026)).toBe('kein Konto – schriftlich hinweisen')
    // The notice is about one year: beside another year's leave the line stays away.
    expect(forfeitText({ year: 2026, status: 'open', readAt: null }, 2027)).toBeNull()
    // Leave an Elternzeit protects: beside the year it has to be taken in (the year of its date), naming its own year.
    const moved = { year: 2028, status: 'open' as const, readAt: null, protectedUntil: '2029-12-31' }
    expect(forfeitText(moved, 2029)).toBe('Resturlaub 2028 (Elternzeit): Hinweis offen')
    expect(forfeitText(moved, 2028)).toBeNull()
  })
})
