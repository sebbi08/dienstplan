import { describe, expect, it } from 'vitest'
import { formatBirthday, parseBirthday } from '../../app/utils/birthday'

const NOW = 2026

describe('parseBirthday', () => {
  it('accepts day and month with or without leading zeros and trailing dot', () => {
    for (const text of ['4.3.', '04.03.', '4.3', ' 04.03. ']) {
      expect(parseBirthday(text, false, NOW)).toEqual({ ok: true, birthday: '03-04', year: null })
      expect(parseBirthday(text, true, NOW)).toEqual({ ok: true, birthday: '03-04', year: null })
    }
  })
  it('accepts a year when it may be entered', () => {
    expect(parseBirthday('14.03.1985', true, NOW)).toEqual({ ok: true, birthday: '03-14', year: 1985 })
    expect(parseBirthday('4.3.1985', true, NOW)).toEqual({ ok: true, birthday: '03-04', year: 1985 })
    expect(parseBirthday('29.02.2000', true, NOW)).toEqual({ ok: true, birthday: '02-29', year: 2000 })
    expect(parseBirthday('01.01.2026', true, NOW)).toEqual({ ok: true, birthday: '01-01', year: 2026 })
  })
  it('an empty field means no birthday', () => {
    expect(parseBirthday('', true, NOW)).toEqual({ ok: true, birthday: null, year: null })
    expect(parseBirthday('   ', false, NOW)).toEqual({ ok: true, birthday: null, year: null })
  })
  it('29 February is fine without a year', () => {
    expect(parseBirthday('29.2.', false, NOW)).toEqual({ ok: true, birthday: '02-29', year: null })
  })
  it('rejects what is not a real date', () => {
    for (const text of ['31.02.', '31.04.', '0.3.', '4.0.', '4.13.', '32.1.', 'abc', '4-3-', '4.3.85', '4.3.19855', '03.', '29.02.2001', '14.03.1899', '14.03.2027']) {
      expect(parseBirthday(text, true, NOW), text).toEqual({ ok: false })
    }
  })
  it('rejects a year where only day and month are allowed', () => {
    expect(parseBirthday('14.03.1985', false, NOW)).toEqual({ ok: false })
  })
})

describe('formatBirthday', () => {
  it('writes TT.MM. and TT.MM.JJJJ', () => {
    expect(formatBirthday('03-04', null, false)).toBe('04.03.')
    expect(formatBirthday('03-04', 1985, true)).toBe('04.03.1985')
    expect(formatBirthday('03-04', null, true)).toBe('04.03.')
  })
  it('leaves out the year where it may not be shown', () => {
    expect(formatBirthday('03-04', 1985, false)).toBe('04.03.')
  })
  it('is empty without a birthday', () => {
    expect(formatBirthday(null, null, true)).toBe('')
    expect(formatBirthday(null, 1985, true)).toBe('')
  })
})
