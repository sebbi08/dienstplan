import { afterEach, describe, expect, it, vi } from 'vitest'
import { dateRange, isWeekend } from '../../shared/domain/dates'
import { condenseWarnings, warningAckKey, warningSections, warningSignature } from '../../shared/domain/warningList'
import type { Warning } from '../../shared/domain/warnings'
import {
  daySpanText, openDaysOf, readWarningFilter, warningLineText, warningSummary, weekdaySpanText, writeWarningFilter,
} from '../../app/utils/warnings'

const names = new Map([[1, 'Anna']])
const open = new Set(dateRange('2026-10-01', '2026-10-31').filter(date => !isWeekend(date)))
const line = (warnings: Warning[]) => {
  const [first] = condenseWarnings(warnings, open)
  return first!
}

describe('warning line texts', () => {
  it('writes the days short', () => {
    expect(daySpanText('2026-10-01', '2026-10-16')).toBe('01.–16.10.')
    expect(daySpanText('2026-09-28', '2026-10-02')).toBe('28.09.–02.10.')
    expect(weekdaySpanText('2026-10-05', '2026-10-09')).toBe('Mo 05.–Fr 09.10.')
    expect(weekdaySpanText('2026-10-05', '2026-10-05')).toBe('Mo 05.10.')
  })

  it('names a group gap over days with its range first', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
    const text = warningLineText(line(days.map(date => ({
      type: 'staffing', date, groupId: 7, groupName: 'Bären', from: 420, to: 480, have: 1, need: 2, fachkraft: true,
    }))), names)
    expect(text).toBe('Mo 05.–Fr 09.10. · Bären 7:00–8:00: 1 Fachkraft, nötig 2')
  })

  it('counts the days of a person', () => {
    const days = dateRange('2026-10-01', '2026-10-16').filter(date => !isWeekend(date))
    expect(warningLineText(line(days.map(date => ({ type: 'missing_entry', date, employeeId: 1 }))), names))
      .toBe('Anna · 12 Tage ohne Eintrag (01.–16.10.)')
    const gaps: Warning[] = ['2026-10-05', '2026-10-06'].map((date, index) => ({ type: 'target_gap', date, employeeId: 1, missingMinutes: 60 + index * 30 }))
    expect(warningLineText(line(gaps), names)).toBe('Anna · Sollstunden: 2 Tage, zusammen 2:30 h zu wenig (05.–06.10.)')
  })

  it('words a stamp on a day with a full-day absence', () => {
    expect(warningLineText(line([{ type: 'record_on_absence', date: '2026-10-05', employeeId: 1 }]), names)).toBe(
      'Mo 05.10. · Anna: gestempelt trotz ganztägiger Abwesenheit (z. B. Urlaub, Schließtag) – die Zeit zählt erst, wenn der Tag im Dienstplan geändert wird',
    )
    const days: Warning[] = ['2026-10-05', '2026-10-06'].map(date => ({ type: 'record_on_absence', date, employeeId: 1 }))
    expect(warningLineText(line(days), names)).toBe('Anna · 2 Tage gestempelt trotz ganztägiger Abwesenheit (05.–06.10.)')
  })

  it('keeps the single day as before, with its date first', () => {
    expect(warningLineText(line([{ type: 'missing_entry', date: '2026-10-05', employeeId: 1 }]), names)).toBe('Mo 05.10. · Anna: kein Eintrag')
  })
})

describe('warningSummary', () => {
  it('counts only the warnings not acknowledged', () => {
    const warnings: Warning[] = [
      { type: 'missing_entry', date: '2026-10-26', employeeId: 1 }, { type: 'missing_entry', date: '2026-10-27', employeeId: 1 },
      { type: 'open_record', date: '2026-10-20', employeeId: 1 },
    ]
    const acks = new Map([[warningAckKey(warnings[0]!), warningSignature(warnings[0]!)]])
    expect(warningSummary(warningSections(warnings, acks, open, '2026-10-23')))
      .toEqual({ total: 2, line: 'Besetzung 0 · Lücken 1 · Zeiterfassung 1' })
  })
})

describe('openDaysOf', () => {
  it('leaves out weekends, holidays and closures', () => {
    const day = (date: string, extra: object = {}) => ({ date, isWeekend: isWeekend(date), holidayKey: null, closureLabel: null, ...extra })
    expect([...openDaysOf([
      day('2026-10-02'), day('2026-10-03'), day('2026-10-05', { holidayKey: 'all_saints_day' }), day('2026-10-06', { closureLabel: 'Team' }),
      day('2026-10-07'),
    ])]).toEqual(['2026-10-02', '2026-10-07'])
  })
})

describe('the remembered filter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps group and person per device', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(readWarningFilter()).toEqual({ groupId: null, employeeId: null })
    writeWarningFilter({ groupId: 7, employeeId: null })
    expect(readWarningFilter()).toEqual({ groupId: 7, employeeId: null })
    writeWarningFilter({ groupId: null, employeeId: null })
    expect(store.size).toBe(0)
  })

  it('works without storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(readWarningFilter()).toEqual({ groupId: null, employeeId: null })
    expect(() => writeWarningFilter({ groupId: 1, employeeId: 2 })).not.toThrow()
  })
})
