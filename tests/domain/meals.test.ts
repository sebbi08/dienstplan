import { describe, expect, it } from 'vitest'
import { currentAndPlanned, mealsOn } from '../../shared/domain/meals'
import type { MealVersion } from '../../shared/domain/meals'

let nextId = 1
const version = (over: Partial<MealVersion> & { mealId: number }): MealVersion =>
  ({ id: nextId++, validFrom: null, name: 'Frühstück', time: 480, removed: false, ...over })

describe('mealsOn', () => {
  it('applies a version since always on any date', () => {
    const versions = [version({ mealId: 1 })]
    expect(mealsOn(versions, '2020-01-01')).toEqual([{ mealId: 1, name: 'Frühstück', time: 480 }])
    expect(mealsOn(versions, '2030-12-31')).toHaveLength(1)
  })
  it('applies a dated version from its day on, not before', () => {
    const versions = [version({ mealId: 1, validFrom: '2026-11-01' })]
    expect(mealsOn(versions, '2026-10-31')).toEqual([])
    expect(mealsOn(versions, '2026-11-01')).toHaveLength(1)
  })
  it('takes the latest version that has started', () => {
    const versions = [
      version({ mealId: 1, name: 'Frühstück', time: 480 }),
      version({ mealId: 1, validFrom: '2026-11-01', name: 'Brunch', time: 570 }),
      version({ mealId: 1, validFrom: '2027-01-01', name: 'Imbiss', time: 600 }),
    ]
    expect(mealsOn(versions, '2026-10-31')).toEqual([{ mealId: 1, name: 'Frühstück', time: 480 }])
    expect(mealsOn(versions, '2026-12-01')).toEqual([{ mealId: 1, name: 'Brunch', time: 570 }])
    expect(mealsOn(versions, '2027-01-01')).toEqual([{ mealId: 1, name: 'Imbiss', time: 600 }])
  })
  it('hides a meal from the day a removed version starts', () => {
    const versions = [
      version({ mealId: 1 }),
      version({ mealId: 1, validFrom: '2026-11-01', removed: true }),
    ]
    expect(mealsOn(versions, '2026-10-31')).toHaveLength(1)
    expect(mealsOn(versions, '2026-11-01')).toEqual([])
    expect(mealsOn(versions, '2027-05-01')).toEqual([])
  })
  it('keeps meals apart by mealId', () => {
    const versions = [
      version({ mealId: 1 }),
      version({ mealId: 2, name: 'Mittag', time: 720 }),
      version({ mealId: 2, validFrom: '2026-11-01', removed: true }),
    ]
    expect(mealsOn(versions, '2026-11-01').map(meal => meal.mealId)).toEqual([1])
  })
  it('sorts by time, then by name', () => {
    const versions = [
      version({ mealId: 1, name: 'Mittag', time: 720 }),
      version({ mealId: 2, name: 'Zwischenmahlzeit', time: 600 }),
      version({ mealId: 3, name: 'Äpfel', time: 600 }),
      version({ mealId: 4, name: 'Brei', time: 600 }),
    ]
    expect(mealsOn(versions, '2026-10-19').map(meal => meal.name)).toEqual(['Äpfel', 'Brei', 'Zwischenmahlzeit', 'Mittag'])
  })
})

describe('currentAndPlanned', () => {
  it('splits into what applies today and the versions still to come', () => {
    const versions = [
      version({ mealId: 1, name: 'Frühstück', time: 480 }),
      version({ mealId: 1, validFrom: '2026-12-01', name: 'Brunch', time: 570 }),
      version({ mealId: 2, validFrom: '2026-11-01', name: 'Mittag', time: 720 }),
      version({ mealId: 3, validFrom: '2026-10-01', name: 'Obst', time: 600 }),
      version({ mealId: 4, validFrom: '2026-11-01', name: 'Vesper', time: 540 }),
    ]
    const result = currentAndPlanned(versions, '2026-10-19')
    expect(result.current.map(meal => meal.name)).toEqual(['Frühstück', 'Obst'])
    expect(result.planned.map(v => v.name)).toEqual(['Vesper', 'Mittag', 'Brunch'])
  })
  it('does not plan a version that starts today', () => {
    const versions = [version({ mealId: 1, validFrom: '2026-10-19' })]
    const result = currentAndPlanned(versions, '2026-10-19')
    expect(result.current).toHaveLength(1)
    expect(result.planned).toEqual([])
  })
})
