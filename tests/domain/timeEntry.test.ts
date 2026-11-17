import { describe, expect, it } from 'vitest'
import type { CodeDto } from '../../shared/types/api'
import { de } from '../../app/locales/de'
import { allowsFullDay, timeEntryInput, type TimeEntryForm } from '../../app/utils/timeEntry'

const office: CodeDto = { id: 6, key: 'office', label: 'Büro', color: 'yellow', creditMode: 'timed', requiresTimes: true, sortOrder: 5 }
const training: CodeDto = { id: 4, key: 'training', label: 'Fortbildung', color: 'gray', creditMode: 'daily_target', requiresTimes: true, sortOrder: 7 }
const form = (values: Partial<TimeEntryForm> = {}): TimeEntryForm => ({
  start: '', end: '', breakStart: '', breakEnd: '', note: '', homeOffice: false, ...values,
})

describe('the entry typed into the dialog for a special shift or a code with times', () => {
  it('sends the typed times of a timed code', () => {
    expect(timeEntryInput(form({ start: '8:00', end: '12:00', homeOffice: true }), office)).toEqual({
      entry: { kind: 'code', codeId: 6, start: 480, end: 720, breakStart: null, breakEnd: null, note: null, homeOffice: true },
    })
  })
  it('sends a timed code without times as a whole day (Büro ganzer Tag), with or without home office', () => {
    expect(timeEntryInput(form({ note: ' Elternabend ' }), office)).toEqual({
      entry: { kind: 'code', codeId: 6, note: 'Elternabend', homeOffice: false },
    })
    expect(timeEntryInput(form({ homeOffice: true }), office)).toEqual({
      entry: { kind: 'code', codeId: 6, note: null, homeOffice: true },
    })
  })
  it('allows a whole day only for timed codes, not for a special shift or another code', () => {
    expect(allowsFullDay(office)).toBe(true)
    expect(allowsFullDay(null)).toBe(false)
    expect(allowsFullDay(training)).toBe(false)
    expect(timeEntryInput(form(), null)).toEqual({ error: de.spanErrors.missing_times })
    expect(timeEntryInput(form(), training)).toEqual({ error: de.spanErrors.missing_times })
  })
  it('refuses a break on a whole day and a half-filled time', () => {
    expect(timeEntryInput(form({ breakStart: '12:00', breakEnd: '12:30' }), office)).toEqual({ error: de.modal.fullDayNoBreak })
    expect(timeEntryInput(form({ start: '8:00' }), office)).toEqual({ error: de.spanErrors.missing_times })
  })
  it('refuses unreadable times and a break outside the times', () => {
    expect(timeEntryInput(form({ start: 'acht', end: '12:00' }), office)).toEqual({ error: de.common.invalidTime })
    expect(timeEntryInput(form({ start: '8:00', end: '12:00', breakStart: '13:00', breakEnd: '13:30' }), null))
      .toEqual({ error: de.spanErrors.break_outside })
  })
})
