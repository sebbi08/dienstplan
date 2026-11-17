import { describe, expect, it } from 'vitest'
import { homeOfficeLines } from '../../app/utils/homeOffice'

describe('the home-office lines of a day in „Mein Dienstplan“', () => {
  it('names each home-office span counting as recorded, as on the admin time page', () => {
    expect(homeOfficeLines([{ start: 480, end: 720 }, { start: 840, end: 930 }]))
      .toEqual(['Homeoffice (laut Plan) 8:00–12:00', 'Homeoffice (laut Plan) 14:00–15:30'])
  })
  it('says nothing for a day without home office', () => {
    expect(homeOfficeLines([])).toEqual([])
    expect(homeOfficeLines(undefined)).toEqual([])
  })
})
