import { describe, expect, it } from 'vitest'
import { cashMonthPath, centsInput, parseStartBalance } from '../../app/utils/cash'

describe('parseStartBalance', () => {
  it.each([
    ['', 0], ['  ', 0], ['0', 0], ['0,00', 0], ['0.0', 0], [',00', 0],
    ['150', 15000], ['150,5', 15050], ['150.55', 15055],
    [',', null], ['.', null], ['-1', null], ['abc', null], ['1,234', null], ['1.234,56', null],
  ])('%j → %j', (text, cents) => {
    expect(parseStartBalance(text)).toBe(cents)
  })
})

describe('centsInput', () => {
  it('writes cents as typed into an amount field', () => {
    expect(centsInput(0)).toBe('0,00')
    expect(centsInput(5)).toBe('0,05')
    expect(centsInput(123456)).toBe('1234,56')
  })
})

describe('cashMonthPath', () => {
  it('points to the month sheet', () => {
    expect(cashMonthPath(3, 2026, 9)).toBe('/cash/3/2026/9')
  })
})
