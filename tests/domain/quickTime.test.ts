import { describe, expect, it } from 'vitest'
import { parseQuickTime } from '../../shared/domain/quickTime'

const span = (start: number, end: number, breakStart: number | null = null, breakEnd: number | null = null) =>
  ({ span: { start, end, breakStart, breakEnd } })

describe('a time typed into a cell', () => {
  it('reads start and end in the ways TimeInput takes a time, with any dash or „bis“', () => {
    expect(parseQuickTime('7:30-14:00')).toEqual(span(450, 840))
    expect(parseQuickTime('730-14')).toEqual(span(450, 840))
    expect(parseQuickTime('7.30–14')).toEqual(span(450, 840))
    expect(parseQuickTime('7,30 — 14,00')).toEqual(span(450, 840))
    expect(parseQuickTime('7:30−14')).toEqual(span(450, 840)) // the minus sign U+2212
    expect(parseQuickTime('7:30-14 P 11:30 − 12')).toEqual(span(450, 840, 690, 720))
    expect(parseQuickTime('0730-1400')).toEqual(span(450, 840))
    expect(parseQuickTime('7:30 bis 14 ')).toEqual(span(450, 840))
    expect(parseQuickTime('  7 - 16:45')).toEqual(span(420, 1005))
    expect(parseQuickTime('14-24')).toEqual(span(840, 1440))
  })

  it('reads an optional break after „P“ or „Pause“', () => {
    expect(parseQuickTime('7:30-14:00 P 11:30-12:00')).toEqual(span(450, 840, 690, 720))
    expect(parseQuickTime('7:30-14 Pause 11:30-12')).toEqual(span(450, 840, 690, 720))
    expect(parseQuickTime('7:30-14, p 1130–12')).toEqual(span(450, 840, 690, 720))
    expect(parseQuickTime('7-14 pause: 11.30 bis 12')).toEqual(span(420, 840, 690, 720))
    expect(parseQuickTime('7-14P11:30-12')).toEqual(span(420, 840, 690, 720))
  })

  it('refuses what is not a time span', () => {
    expect(parseQuickTime('')).toEqual({ error: 'empty' })
    expect(parseQuickTime('   ')).toEqual({ error: 'empty' })
    expect(parseQuickTime('abc')).toEqual({ error: 'format' })
    expect(parseQuickTime('7:30')).toEqual({ error: 'format' })
    expect(parseQuickTime('7:30-')).toEqual({ error: 'format' })
    expect(parseQuickTime('7:30-14 P 11:30')).toEqual({ error: 'format' })
    expect(parseQuickTime('7:30-14 11:30-12')).toEqual({ error: 'format' })
    expect(parseQuickTime('7:30-14 X 11:30-12')).toEqual({ error: 'format' })
  })

  it('refuses impossible clock times', () => {
    expect(parseQuickTime('7:75-14')).toEqual({ error: 'invalid_time' })
    expect(parseQuickTime('25-26')).toEqual({ error: 'invalid_time' })
    expect(parseQuickTime('7-14 P 11:30-12:60')).toEqual({ error: 'invalid_time' })
  })

  it('keeps the 5-minute grid, an end after the start and the break inside the shift', () => {
    expect(parseQuickTime('7:32-14')).toEqual({ error: 'not_on_grid' })
    expect(parseQuickTime('7:30-14 P 11:33-12')).toEqual({ error: 'not_on_grid' })
    expect(parseQuickTime('14-7:30')).toEqual({ error: 'end_before_start' })
    expect(parseQuickTime('7:30-7:30')).toEqual({ error: 'end_before_start' })
    expect(parseQuickTime('7:30-14 P 13:30-14:30')).toEqual({ error: 'break_outside' })
    expect(parseQuickTime('7:30-14 P 7-8')).toEqual({ error: 'break_outside' })
    expect(parseQuickTime('7:30-14 P 12-11:30')).toEqual({ error: 'break_outside' })
  })
})
