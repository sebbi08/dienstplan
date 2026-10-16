import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { dayHoursText, fromHoursForm, toHoursForm, weekdaysText } from '../../app/utils/openingHours'

describe('edge warning text', () => {
  it('names the time, the edge and how many are planned, with the group first', () => {
    expect(de.warnings.edge('opening', '7:00', 0, 1)).toBe('7:00 Öffnung: niemand eingeplant')
    expect(de.warnings.edge('closing', '16:30', 1, 2, 'Mäuse')).toBe('Mäuse – 16:30 Schließung: 1 von 2 eingeplant')
  })
})

describe('weekdaysText', () => {
  it('is empty for all weekdays and names ranges and single days otherwise', () => {
    expect(weekdaysText(31)).toBe('')
    expect(weekdaysText(1 | 2 | 4 | 8)).toBe('Mo–Do')
    expect(weekdaysText(16)).toBe('Fr')
    expect(weekdaysText(1 | 4 | 8 | 16)).toBe('Mo, Mi–Fr')
    expect(weekdaysText(1 | 2)).toBe('Mo, Di')
  })
})

describe('dayHoursText', () => {
  it('shows the times, "geschlossen" or nothing', () => {
    expect(dayHoursText({ open: 420, close: 990, closed: false })).toBe('7:00–16:30')
    expect(dayHoursText({ open: null, close: null, closed: true })).toBe('geschlossen')
    expect(dayHoursText({ open: null, close: null, closed: false })).toBeNull()
    expect(dayHoursText(undefined)).toBeNull()
  })
})

describe('hours form', () => {
  it('round-trips saved hours and drops times of a closed day', () => {
    const hours = {
      days: [
        { open: 420, close: 990, closed: false }, { open: null, close: null, closed: true },
        { open: null, close: null, closed: false }, { open: null, close: null, closed: false }, { open: null, close: null, closed: false },
      ],
      minAtOpening: 2, minAtClosing: 1,
    }
    const form = toHoursForm(hours)
    expect(form.days[0]).toEqual({ open: '7:00', close: '16:30', closed: false })
    expect(fromHoursForm(form)).toEqual(hours)
    form.days[0]!.closed = true
    expect(fromHoursForm(form)!.days[0]).toEqual({ open: null, close: null, closed: true })
  })

  it('has an empty form with the default minimum counts for nothing saved, and rejects unreadable times', () => {
    const form = toHoursForm(null)
    expect(form.minAtOpening).toBe(1)
    expect(fromHoursForm(form)!.days.every(day => day.open === null && !day.closed)).toBe(true)
    form.days[2]!.open = 'abc'
    expect(fromHoursForm(form)).toBeNull()
  })
  it('sends an emptied minimum count as a number the server rejects, not as a string', () => {
    const form = toHoursForm(null)
    ;(form as { minAtOpening: unknown }).minAtOpening = ''
    ;(form as { minAtClosing: unknown }).minAtClosing = null
    const hours = fromHoursForm(form)!
    expect(typeof hours.minAtOpening).toBe('number')
    expect(typeof hours.minAtClosing).toBe('number')
    expect(hours.minAtOpening).toBeLessThan(1)
    expect(hours.minAtClosing).toBeLessThan(1)
  })
})
