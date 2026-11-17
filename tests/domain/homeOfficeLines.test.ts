import { describe, expect, it } from 'vitest'
import { homeOfficeLines } from '../../app/utils/homeOffice'
import { code, M, shift } from '../helpers/entries'

const date = '2026-10-06'

describe('the home-office lines of a day in „Mein Dienstplan“', () => {
  it('names each home-office entry with its times, as on the admin time page', () => {
    expect(homeOfficeLines([
      shift(1, date, 480, 720, null, null, { homeOffice: true }),
      { ...code(1, date, 'office', 'timed', 840, 930), homeOffice: true },
    ])).toEqual(['Homeoffice (laut Plan) 8:00–12:00', 'Homeoffice (laut Plan) 14:00–15:30'])
  })
  it('says nothing for a day without home office', () => {
    expect(homeOfficeLines([shift(1, date, ...M), code(1, date, 'vacation', 'daily_target')])).toEqual([])
    expect(homeOfficeLines([])).toEqual([])
  })
})
