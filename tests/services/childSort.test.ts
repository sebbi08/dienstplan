import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import type { ChildActor } from '../../server/lib/childViewer'
import { childSortSchema } from '../../server/schemas'
import { getAttendanceDay, getAttendanceMonth } from '../../server/services/childAttendance'
import { getChildSort, setChildSort } from '../../server/services/childSort'
import { childrenOverview, listBirthdays, listChildren } from '../../server/services/children'
import { addChild, addFacility, addGroup, addUser, asChildViewer, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-14'
const NOW = new Date('2026-10-14T08:00:00.000Z')

describe('the facility\'s sort order of the child lists', () => {
  let db: Db
  let leitung: ChildActor
  beforeEach(() => {
    db = createTestDb()
    leitung = asChildViewer(addUser(db, 'leitung', 'admin'))
    const bears = addGroup(db, 1, 'Bären')
    const mice = addGroup(db, 1, 'Mäuse')
    addChild(db, 1, { firstName: 'Özil', lastName: 'Zander', birthDate: '2021-01-01', groupId: bears })
    addChild(db, 1, { firstName: 'Oberle', lastName: 'Adler', birthDate: '2023-01-01', groupId: bears })
    addChild(db, 1, { firstName: 'Bea', lastName: 'Mohr', birthDate: '2022-01-01', groupId: bears })
    addChild(db, 1, { firstName: 'Zoe', lastName: 'Berg', birthDate: '2020-01-01', groupId: mice })
    addChild(db, 1, { firstName: 'Ben', lastName: 'Albers', birthDate: '2024-01-01', groupId: null })
  })

  const listed = () => listChildren(db, 1, 'active', TODAY, null).map(child => child.firstName)
  const overview = () => childrenOverview(db, leitung, TODAY).children.map(child => child.firstName)
  const day = () => getAttendanceDay(db, leitung, TODAY, NOW).children.map(child => child.name.split(', ')[1])
  const month = () => getAttendanceMonth(db, leitung, 2026, 10, NOW).groups.flatMap(group => group.children.map(child => child.name.split(', ')[1]))

  it('defaults to oldest first and keeps the order of the child list', () => {
    expect(getChildSort(db, 1)).toBe('age_desc')
    expect(listed()).toEqual(['Özil', 'Bea', 'Oberle', 'Zoe', 'Ben'])
  })

  it('orders each group by first name, German collation, the groups stay in order', () => {
    setChildSort(db, 1, 'first_asc')
    expect(listed()).toEqual(['Bea', 'Oberle', 'Özil', 'Zoe', 'Ben'])
    setChildSort(db, 1, 'first_desc')
    expect(listed()).toEqual(['Özil', 'Oberle', 'Bea', 'Zoe', 'Ben'])
  })

  it('orders each group by last name or by age', () => {
    setChildSort(db, 1, 'last_asc')
    expect(listed()).toEqual(['Oberle', 'Bea', 'Özil', 'Zoe', 'Ben'])
    setChildSort(db, 1, 'last_desc')
    expect(listed()).toEqual(['Özil', 'Bea', 'Oberle', 'Zoe', 'Ben'])
    setChildSort(db, 1, 'age_asc')
    expect(listed()).toEqual(['Oberle', 'Bea', 'Özil', 'Zoe', 'Ben'])
  })

  it('Anwesenheit (day and month) and the overview follow the setting; the birthdays do not', () => {
    const birthdays = () => listBirthdays(db, 1, TODAY, null).map(entry => entry.name)
    const before = birthdays()
    setChildSort(db, 1, 'first_desc')
    expect(overview()).toEqual(['Özil', 'Oberle', 'Bea', 'Zoe', 'Ben'])
    expect(day()).toEqual(['Özil', 'Oberle', 'Bea', 'Zoe', 'Ben'])
    expect(month()).toEqual(['Özil', 'Oberle', 'Bea', 'Zoe', 'Ben'])
    expect(birthdays()).toEqual(before)
  })

  it('is stored per facility', () => {
    const other = addFacility(db, 'Zweite Kita')
    setChildSort(db, 1, 'last_desc')
    expect(getChildSort(db, other)).toBe('age_desc')
  })

  it('answers 404 for an unknown facility and rejects unknown values', () => {
    expect(errorCode(() => setChildSort(db, 999, 'first_asc'))).toBe('facility_not_found')
    expect(childSortSchema.safeParse({ sort: 'size' }).success).toBe(false)
    expect(childSortSchema.safeParse({ sort: 'first_asc' }).success).toBe(true)
  })
})
