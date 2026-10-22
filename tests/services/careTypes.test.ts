import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  assertCareType, createCareType, deleteCareType, listCareTypes, updateCareType,
} from '../../server/services/careTypes'
import { addChild, addFacility, createTestDb, errorCode } from '../helpers/fixtures'

const input = (name: string, start = 7 * 60, end = 13 * 60, sortOrder = 0) => ({ name, start, end, sortOrder })

describe('care types of a facility', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('creates care types at the end of the order and lists them', () => {
    const first = createCareType(db, 1, input('Halbtag'))
    const second = createCareType(db, 1, input('Ganztag', 7 * 60, 16 * 60))
    expect(first).toEqual({ id: first.id, name: 'Halbtag', start: 420, end: 780, sortOrder: 0, daysPerWeek: 5 })
    expect(second.sortOrder).toBe(1)
    expect(listCareTypes(db, 1).map(type => type.name)).toEqual(['Halbtag', 'Ganztag'])
  })

  it('lists only the facility\'s own care types', () => {
    const other = addFacility(db, 'Andere Kita')
    createCareType(db, 1, input('Halbtag'))
    createCareType(db, other, input('Fremd'))
    expect(listCareTypes(db, 1).map(type => type.name)).toEqual(['Halbtag'])
  })

  it('trims the name and rejects an empty one', () => {
    expect(createCareType(db, 1, input('  Halbtag  ')).name).toBe('Halbtag')
    expect(errorCode(() => createCareType(db, 1, input('   ')))).toBe('care_type_name_required')
  })

  it('rejects a name another care type uses, whatever the case', () => {
    createCareType(db, 1, input('Ganztag'))
    expect(errorCode(() => createCareType(db, 1, input('GANZTAG')))).toBe('care_type_name_taken')
    createCareType(db, 1, input('Ärmel'))
    expect(errorCode(() => createCareType(db, 1, input('ärmel')))).toBe('care_type_name_taken')
  })

  it('allows the same name in another facility', () => {
    const other = addFacility(db, 'Andere Kita')
    createCareType(db, 1, input('Halbtag'))
    expect(errorCode(() => createCareType(db, other, input('Halbtag')))).toBeNull()
  })

  it('rejects times off the 5-minute grid and ends not after the start', () => {
    expect(errorCode(() => createCareType(db, 1, input('A', 421, 780)))).toBe('care_type_invalid_time')
    expect(errorCode(() => createCareType(db, 1, input('A', 420, 783)))).toBe('care_type_invalid_time')
    expect(errorCode(() => createCareType(db, 1, input('A', 420, 420)))).toBe('care_type_invalid_time')
    expect(errorCode(() => createCareType(db, 1, input('A', 480, 420)))).toBe('care_type_invalid_time')
    expect(errorCode(() => createCareType(db, 1, input('A', -5, 420)))).toBe('care_type_invalid_time')
    expect(errorCode(() => createCareType(db, 1, input('A', 420, 1445)))).toBe('care_type_invalid_time')
    expect(listCareTypes(db, 1)).toEqual([])
  })

  it('updates name, times and position; keeping its own name is no clash', () => {
    const type = createCareType(db, 1, input('Halbtag'))
    const other = createCareType(db, 1, input('Ganztag'))
    const updated = updateCareType(db, 1, type.id, input('HALBTAG', 480, 720, 5))
    expect(updated).toEqual({ id: type.id, name: 'HALBTAG', start: 480, end: 720, sortOrder: 5, daysPerWeek: 5 })
    expect(listCareTypes(db, 1).map(entry => entry.id)).toEqual([other.id, type.id])
    expect(errorCode(() => updateCareType(db, 1, type.id, input('ganztag')))).toBe('care_type_name_taken')
    expect(errorCode(() => updateCareType(db, 1, type.id, input('X', 421, 720)))).toBe('care_type_invalid_time')
    expect(errorCode(() => updateCareType(db, 1, type.id, input(' ')))).toBe('care_type_name_required')
  })

  it('has 5 care days per week unless given, keeps them when left out and accepts 1 to 7', () => {
    const type = createCareType(db, 1, input('Halbtag'))
    expect(type.daysPerWeek).toBe(5)
    expect(createCareType(db, 1, { ...input('Dreitage'), daysPerWeek: 3 }).daysPerWeek).toBe(3)
    expect(updateCareType(db, 1, type.id, { ...input('Halbtag'), daysPerWeek: 7 }).daysPerWeek).toBe(7)
    expect(updateCareType(db, 1, type.id, input('Halbtag')).daysPerWeek).toBe(7)
    expect(updateCareType(db, 1, type.id, { ...input('Halbtag'), daysPerWeek: 1 }).daysPerWeek).toBe(1)
    expect(listCareTypes(db, 1).map(entry => entry.daysPerWeek)).toEqual([1, 3])
  })

  it('refuses care days outside 1 to 7 or not whole, and changes nothing', () => {
    const type = createCareType(db, 1, input('Halbtag'))
    for (const daysPerWeek of [0, 8, 2.5, -1, Number.NaN]) {
      expect(errorCode(() => createCareType(db, 1, { ...input('Neu'), daysPerWeek })), String(daysPerWeek)).toBe('care_type_invalid_days')
      expect(errorCode(() => updateCareType(db, 1, type.id, { ...input('Anders'), daysPerWeek })), String(daysPerWeek))
        .toBe('care_type_invalid_days')
    }
    expect(listCareTypes(db, 1)).toEqual([{ ...type }])
  })

  it('treats another facility\'s care type as not found', () => {
    const other = addFacility(db, 'Andere Kita')
    const foreign = createCareType(db, other, input('Fremd'))
    expect(errorCode(() => updateCareType(db, 1, foreign.id, input('X')))).toBe('care_type_not_found')
    expect(errorCode(() => deleteCareType(db, 1, foreign.id))).toBe('care_type_not_found')
    expect(errorCode(() => assertCareType(db, 1, foreign.id))).toBe('care_type_not_found')
    expect(errorCode(() => assertCareType(db, 1, 9999))).toBe('care_type_not_found')
    expect(listCareTypes(db, other)).toHaveLength(1)
  })

  it('lets null pass the assertion (no care type)', () => {
    expect(errorCode(() => assertCareType(db, 1, null))).toBeNull()
    const type = createCareType(db, 1, input('Halbtag'))
    expect(errorCode(() => assertCareType(db, 1, type.id))).toBeNull()
  })

  it('deletes an unused care type', () => {
    const type = createCareType(db, 1, input('Halbtag'))
    deleteCareType(db, 1, type.id)
    expect(listCareTypes(db, 1)).toEqual([])
  })

  it('refuses to delete a care type a child has', () => {
    const type = createCareType(db, 1, input('Halbtag'))
    addChild(db, 1, { careTypeId: type.id })
    expect(errorCode(() => deleteCareType(db, 1, type.id))).toBe('care_type_in_use')
    expect(listCareTypes(db, 1)).toHaveLength(1)
  })
})
