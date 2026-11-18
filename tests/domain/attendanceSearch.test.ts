import { describe, expect, it } from 'vitest'
import { attendanceSearchKey, filterAttendanceChildren, matchesAttendanceSearch } from '../../app/utils/attendanceSearch'

const child = (firstName: string, lastName: string, childId = 1) => ({ childId, firstName, lastName, name: `${lastName}, ${firstName}` })

describe('search key of the day list', () => {
  it('ignores case, accents and surrounding or doubled spaces', () => {
    expect(attendanceSearchKey('  Jürgen   MÜLLER ')).toBe('jurgen muller')
    expect(attendanceSearchKey('Zoë')).toBe('zoe')
    expect(attendanceSearchKey('')).toBe('')
  })
})

describe('searching a child of the day list', () => {
  const lena = child('Lena', 'Müller')

  it('finds by first name, last name and "Vorname Nachname", any part of it', () => {
    expect(matchesAttendanceSearch(lena, 'len')).toBe(true)
    expect(matchesAttendanceSearch(lena, 'mül')).toBe(true)
    expect(matchesAttendanceSearch(lena, 'Lena Mü')).toBe(true)
    expect(matchesAttendanceSearch(lena, 'na mu')).toBe(true)
    expect(matchesAttendanceSearch(lena, 'Ben')).toBe(false)
  })

  it('also finds the name as the list shows it ("Nachname, Vorname")', () => {
    expect(matchesAttendanceSearch(lena, 'Müller, Le')).toBe(true)
  })

  it('is case- and accent-insensitive both ways ("a" finds "ä", "ä" finds "a"); "ae" for "ä" is not needed', () => {
    expect(matchesAttendanceSearch(lena, 'MULLER')).toBe(true)
    expect(matchesAttendanceSearch(child('Lena', 'Muller'), 'Müller')).toBe(true)
    expect(matchesAttendanceSearch(child('Zoë', 'Bär'), 'zoe bar')).toBe(true)
    expect(matchesAttendanceSearch(lena, 'Mueller')).toBe(false)
  })

  it('an empty or blank search finds everyone', () => {
    expect(matchesAttendanceSearch(lena, '')).toBe(true)
    expect(matchesAttendanceSearch(lena, '   ')).toBe(true)
  })

  it('filters a list, keeping its order', () => {
    const rows = [child('Lena', 'Müller', 1), child('Ben', 'Schulz', 2), child('Marlene', 'Kraus', 3)]
    expect(filterAttendanceChildren(rows, 'lene').map(row => row.childId)).toEqual([3])
    expect(filterAttendanceChildren(rows, 'le').map(row => row.childId)).toEqual([1, 3])
    expect(filterAttendanceChildren(rows, '').map(row => row.childId)).toEqual([1, 2, 3])
    expect(filterAttendanceChildren(rows, 'xyz')).toEqual([])
  })
})
