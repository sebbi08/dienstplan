import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttendanceChildDto, AttendanceStatus, AttendanceStayDto } from '../../shared/types/api'
import {
  attendanceQuickAction, attendanceRowTone, attendanceSummaryParts, closedGroupWarnings, compactStatusText, countedMealNames,
  readAttendanceSummaryOpen, readClosedAttendanceGroups, visibleAttendanceRows, writeAttendanceSummaryOpen, writeClosedAttendanceGroups,
} from '../../app/utils/attendanceRow'

const stay = (arrived: number, left: number | null): AttendanceStayDto => ({
  id: 1, arrived, left, pickedUpBy: left === null ? null : 'Mama', pickedUpOther: false, pickedUpConfirmedWith: '',
})
const child = (status: AttendanceStatus, stays: AttendanceStayDto[] = []) => ({ status, stays }) as AttendanceChildDto

describe('row colour of the day list', () => {
  it('follows the status: here, picked up, away, unexcused, not here yet', () => {
    expect(attendanceRowTone(child('present'), false)).toBe('present')
    expect(attendanceRowTone(child('gone'), false)).toBe('gone')
    expect(attendanceRowTone(child('sick'), false)).toBe('absent')
    expect(attendanceRowTone(child('vacation'), false)).toBe('absent')
    expect(attendanceRowTone(child('excused'), false)).toBe('absent')
    expect(attendanceRowTone(child('unexcused'), false)).toBe('unexcused')
    expect(attendanceRowTone(child('not_yet'), false)).toBe('not_yet')
  })

  it('is red for an overdue pickup, whatever the status', () => {
    expect(attendanceRowTone(child('present'), true)).toBe('overdue')
  })
})

describe('status of the compact row', () => {
  it('shows the time of arrival and of pickup, without the pickup person', () => {
    expect(compactStatusText(child('present', [stay(465, null)]))).toBe('da seit 7:45')
    expect(compactStatusText(child('gone', [stay(465, 600), stay(780, 910)]))).toBe('abgeholt um 15:10')
    expect(compactStatusText(child('present', [stay(465, 600), stay(780, null)]))).toBe('da seit 13:00')
  })

  it('names the absence or that the child is not here yet', () => {
    expect(compactStatusText(child('sick'))).toBe('krank')
    expect(compactStatusText(child('vacation'))).toBe('Urlaub')
    expect(compactStatusText(child('excused'))).toBe('entschuldigt')
    expect(compactStatusText(child('unexcused'))).toBe('unentschuldigt')
    expect(compactStatusText(child('not_yet'))).toBe('noch nicht da')
  })

  it('says only "abgeholt" when the time is missing', () => {
    expect(compactStatusText(child('gone'))).toBe('abgeholt')
  })
})

describe('quick action of the compact row', () => {
  it('is "Geht" while here and "Kommt" otherwise, as the full row', () => {
    expect(attendanceQuickAction(child('present'), false)).toBe('leave')
    for (const status of ['not_yet', 'gone', 'sick', 'unexcused'] as const) expect(attendanceQuickAction(child(status), false)).toBe('arrive')
  })

  it('is missing on a later day', () => {
    expect(attendanceQuickAction(child('not_yet'), true)).toBeNull()
    expect(attendanceQuickAction(child('present'), true)).toBeNull()
  })
})

describe('meals of the compact row', () => {
  it('lists the counted meals in the order of the day', () => {
    const meals = [{ mealId: 2, name: 'Frühstück', time: 480 }, { mealId: 1, name: 'Mittagessen', time: 720 }, { mealId: 3, name: 'Snack', time: 900 }]
    const row = { meals: { 1: { counted: true, manual: false }, 2: { counted: true, manual: true }, 3: { counted: false, manual: true } } } as unknown as AttendanceChildDto
    expect(countedMealNames(row, meals)).toEqual(['Frühstück', 'Mittagessen'])
    expect(countedMealNames({ meals: {} } as AttendanceChildDto, meals)).toEqual([])
  })
})

describe('closed groups remembered per device', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the closed groups and forgets them when all are open again', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(readClosedAttendanceGroups()).toEqual([])
    writeClosedAttendanceGroups(['7', 'none'])
    expect(readClosedAttendanceGroups()).toEqual(['7', 'none'])
    writeClosedAttendanceGroups([])
    expect(store.size).toBe(0)
  })

  it('ignores an unreadable value', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"a":1', setItem: () => {}, removeItem: () => {} })
    expect(readClosedAttendanceGroups()).toEqual([])
  })

  it('works without storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readClosedAttendanceGroups()).toEqual([])
    expect(() => writeClosedAttendanceGroups(['7'])).not.toThrow()
  })
})

describe('closed groups of the day list', () => {
  const rows = [
    { id: 1, overdue: false, hasContactBan: false },
    { id: 2, overdue: true, hasContactBan: false },
    { id: 3, overdue: false, hasContactBan: true },
  ]
  const overdue = (row: { overdue: boolean }) => row.overdue

  it('keeps only the overdue children of a closed group', () => {
    expect(visibleAttendanceRows(rows, true, overdue).map(row => row.id)).toEqual([2])
    expect(visibleAttendanceRows(rows.filter(row => !row.overdue), true, overdue)).toEqual([])
  })

  it('shows all children of an open group', () => {
    expect(visibleAttendanceRows(rows, false, overdue).map(row => row.id)).toEqual([1, 2, 3])
  })

  it('counts the overdue children and notes a contact ban for the heading', () => {
    expect(closedGroupWarnings(rows, overdue)).toEqual({ overdue: 1, contactBan: true })
    expect(closedGroupWarnings([rows[0]!], overdue)).toEqual({ overdue: 0, contactBan: false })
  })
})

describe('summary line of the day list', () => {
  const counts = { present: 12, gone: 0, absent: 2, notYet: 3, meals: { 1: 10, 2: 8 } }
  const meals = [{ mealId: 1, name: 'Mittagessen', time: 720 }, { mealId: 2, name: 'Snack', time: 570 }]

  it('lists the children, then the meals by time', () => {
    expect(attendanceSummaryParts(counts, meals)).toEqual(['Da 12', 'Noch nicht da 3', 'Abwesend 2', 'Snack 8', 'Mittagessen 10'])
  })

  it('names the picked up children once there are some, and a meal nobody eats with 0', () => {
    expect(attendanceSummaryParts({ ...counts, gone: 4, meals: { 1: 10 } }, meals))
      .toEqual(['Da 12', 'Abgeholt 4', 'Noch nicht da 3', 'Abwesend 2', 'Snack 0', 'Mittagessen 10'])
  })

  it('has no meals on a day without meals', () => {
    expect(attendanceSummaryParts(counts, [])).toEqual(['Da 12', 'Noch nicht da 3', 'Abwesend 2'])
  })
})

describe('summary opened on the device', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is closed until opened, and remembered', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(readAttendanceSummaryOpen()).toBe(false)
    writeAttendanceSummaryOpen(true)
    expect(readAttendanceSummaryOpen()).toBe(true)
    writeAttendanceSummaryOpen(false)
    expect(readAttendanceSummaryOpen()).toBe(false)
    expect(store.size).toBe(0)
  })

  it('stays closed without storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readAttendanceSummaryOpen()).toBe(false)
    expect(() => writeAttendanceSummaryOpen(true)).not.toThrow()
  })
})
