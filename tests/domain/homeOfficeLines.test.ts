import { describe, expect, it } from 'vitest'
import { fullDayLine, homeOfficeLines } from '../../app/utils/homeOffice'

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

describe('the line of a whole Büro or home-office day on the time page', () => {
  it('names the whole day with the credited target instead of a time range', () => {
    expect(fullDayLine({ label: 'Büro (ganzer Tag)', homeOffice: false, minutes: 468 })).toBe('Büro (ganzer Tag): 7:48 (Tagessoll)')
    expect(fullDayLine({ label: 'VZ (ganzer Tag)', homeOffice: true, minutes: 240 })).toBe('Homeoffice (ganzer Tag): 4:00 (Tagessoll)')
  })
})
