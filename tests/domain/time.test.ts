import { describe, expect, it } from 'vitest'
import {
  formatDuration, formatSignedDuration, formatTime, isValidTimeInput, netMinutes,
  parseDuration, parseTime, validateSpan,
} from '../../shared/domain/time'

describe('parseTime', () => {
  it('parses h:mm and hh:mm', () => {
    expect(parseTime('7:45')).toBe(465)
    expect(parseTime('07:45')).toBe(465)
    expect(parseTime('17:00')).toBe(1020)
    expect(parseTime('24:00')).toBe(1440)
  })
  it('parses keyboard shorthands', () => {
    for (const value of ['8:45', '8.45', '8,45', '845', '0845', ' 08:45 ']) expect(parseTime(value)).toBe(525)
    expect(parseTime('14')).toBe(840)
    expect(parseTime('7')).toBe(420)
    expect(parseTime('1400')).toBe(840)
  })
  it('rejects invalid values', () => {
    expect(parseTime('25:00')).toBeNull()
    expect(parseTime('2500')).toBeNull()
    expect(parseTime('24:05')).toBeNull()
    expect(parseTime('7:60')).toBeNull()
    expect(parseTime('7:5')).toBeNull()
    expect(parseTime('12345')).toBeNull()
    expect(parseTime('8 Uhr')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})

describe('isValidTimeInput', () => {
  it('requires a parseable time on the 5-minute grid', () => {
    expect(isValidTimeInput('845')).toBe(true)
    expect(isValidTimeInput('8:43')).toBe(false)
    expect(isValidTimeInput('abc')).toBe(false)
  })
})

describe('parseDuration', () => {
  it('parses hour:minute durations above 24 hours', () => {
    expect(parseDuration('12:30')).toBe(750)
    expect(parseDuration('120:00')).toBe(7200)
    expect(parseDuration('0:05')).toBe(5)
  })
  it('rejects invalid durations', () => {
    expect(parseDuration('12')).toBeNull()
    expect(parseDuration('1:75')).toBeNull()
  })
})

describe('formatting', () => {
  it('formats clock times', () => {
    expect(formatTime(465)).toBe('7:45')
    expect(formatTime(1020)).toBe('17:00')
  })
  it('formats durations with sign', () => {
    expect(formatDuration(465)).toBe('7:45')
    expect(formatDuration(-150)).toBe('−2:30')
    expect(formatSignedDuration(75)).toBe('+1:15')
    expect(formatSignedDuration(0)).toBe('±0:00')
    expect(formatSignedDuration(-5)).toBe('−0:05')
  })
})

describe('netMinutes', () => {
  it('subtracts the break (M: 7:45–16:00, break 11:40–12:10 = 7:45 h)', () => {
    expect(netMinutes({ start: 465, end: 960, breakStart: 700, breakEnd: 730 })).toBe(465)
  })
  it('handles shifts without break (F1: 7:00–13:15 = 6:15 h)', () => {
    expect(netMinutes({ start: 420, end: 795, breakStart: null, breakEnd: null })).toBe(375)
  })
})

describe('validateSpan', () => {
  it('accepts a valid span with and without break', () => {
    expect(validateSpan({ start: 465, end: 960, breakStart: 700, breakEnd: 730 })).toBeNull()
    expect(validateSpan({ start: 420, end: 795, breakStart: null, breakEnd: null })).toBeNull()
  })
  it('rejects minutes off the 5-minute grid', () => {
    expect(validateSpan({ start: 421, end: 795, breakStart: null, breakEnd: null })).toBe('not_on_grid')
  })
  it('rejects end before or equal to start', () => {
    expect(validateSpan({ start: 600, end: 600, breakStart: null, breakEnd: null })).toBe('end_before_start')
    expect(validateSpan({ start: 600, end: 540, breakStart: null, breakEnd: null })).toBe('end_before_start')
  })
  it('rejects a break with only one side', () => {
    expect(validateSpan({ start: 465, end: 960, breakStart: 700, breakEnd: null })).toBe('incomplete_break')
    expect(validateSpan({ start: 465, end: 960, breakStart: null, breakEnd: 730 })).toBe('incomplete_break')
  })
  it('rejects a break outside the span or reversed', () => {
    expect(validateSpan({ start: 465, end: 960, breakStart: 450, breakEnd: 480 })).toBe('break_outside')
    expect(validateSpan({ start: 465, end: 960, breakStart: 950, breakEnd: 970 })).toBe('break_outside')
    expect(validateSpan({ start: 465, end: 960, breakStart: 730, breakEnd: 700 })).toBe('break_outside')
  })
})
