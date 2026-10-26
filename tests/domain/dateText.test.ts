import { describe, expect, it } from 'vitest'
import { autoDots, formatDateText, parseDateText } from '../../app/utils/dateText'

/** Types `text` key by key, like a user on the number keyboard. */
function type(text: string, start = ''): string {
  let value = start
  for (const char of text) value = autoDots(value, value + char)
  return value
}

describe('dates typed as TT.MM.JJJJ', () => {
  it('formats ISO dates and ignores anything else', () => {
    expect(formatDateText('2021-05-03')).toBe('03.05.2021')
    expect(formatDateText('')).toBe('')
    expect(formatDateText(null)).toBe('')
    expect(formatDateText('2021-02-31')).toBe('')
  })

  it('parses valid dates, with or without leading zeros', () => {
    expect(parseDateText('03.05.2021')).toBe('2021-05-03')
    expect(parseDateText('3.5.2021')).toBe('2021-05-03')
    expect(parseDateText(' 31.12.1999 ')).toBe('1999-12-31')
  })

  it('rejects impossible dates', () => {
    expect(parseDateText('31.02.2021')).toBeNull()
    expect(parseDateText('31.04.2021')).toBeNull()
    expect(parseDateText('00.05.2021')).toBeNull()
    expect(parseDateText('12.13.2021')).toBeNull()
  })

  it('knows leap years', () => {
    expect(parseDateText('29.02.2020')).toBe('2020-02-29')
    expect(parseDateText('29.02.2021')).toBeNull()
    expect(parseDateText('29.02.2000')).toBe('2000-02-29')
    expect(parseDateText('29.02.1900')).toBeNull()
  })

  it('rejects two-digit years and incomplete text', () => {
    expect(parseDateText('03.05.21')).toBeNull()
    expect(parseDateText('03.05.')).toBeNull()
    expect(parseDateText('03052021')).toBeNull()
    expect(parseDateText('')).toBeNull()
  })

  it('inserts the dots while typing digits', () => {
    expect(type('0')).toBe('0')
    expect(type('03')).toBe('03.')
    expect(type('0305')).toBe('03.05.')
    expect(type('03052021')).toBe('03.05.2021')
    expect(type('030520219')).toBe('03.05.2021')
  })

  it('accepts dots typed by hand', () => {
    expect(type('03.05.2021')).toBe('03.05.2021')
    expect(type('3.5.2021')).toBe('3.5.2021')
    expect(parseDateText(type('3.5.2021'))).toBe('2021-05-03')
    expect(type('..3')).toBe('3')
  })

  it('formats pasted text and drops other characters', () => {
    expect(autoDots('', '03052021')).toBe('03.05.2021')
    expect(autoDots('', '03/05/2021')).toBe('03.05.2021')
    // Pasted or typed over the whole old date at once: shorter, but no deletion.
    expect(autoDots('01.01.2030', '29022020')).toBe('29.02.2020')
  })

  it('leaves the text alone while deleting', () => {
    expect(autoDots('03.05.', '03.05')).toBe('03.05')
    expect(autoDots('03.', '03')).toBe('03')
    expect(autoDots('03.05.2021', '03.5.2021')).toBe('03.5.2021')
    expect(type('1', '03')).toBe('03.1')
  })
})
