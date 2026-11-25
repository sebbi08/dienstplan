import { describe, expect, it } from 'vitest'
import {
  EXAMPLE_FORM_CATEGORIES, foldFormCategoryName, formCategoriesInTreeOrder, formCategoryRanks, formCategorySpot, groupTemplateChoices,
} from '../../shared/domain/formCategories'
import { FORM_KINDS } from '../../shared/domain/forms'

const rows = [
  { id: 1, parentId: null, name: 'Kinder', sortOrder: 0 },
  { id: 2, parentId: null, name: 'Team', sortOrder: 1 },
  { id: 3, parentId: 1, name: 'Krippe', sortOrder: 1 },
  { id: 4, parentId: 1, name: 'Kita', sortOrder: 0 },
]

describe('form template categories', () => {
  it('has one example category per kind, in the order of the former groups', () => {
    expect(EXAMPLE_FORM_CATEGORIES.map(entry => entry.kind).sort()).toEqual([...FORM_KINDS].sort())
    expect(EXAMPLE_FORM_CATEGORIES.map(entry => entry.name)).toEqual(['Kinder', 'Fachkräfte', 'Team', 'Unfälle', 'Infogespräche', 'Hospitationen'])
  })

  it('orders each category with its subcategories', () => {
    expect(formCategoriesInTreeOrder(rows).map(row => row.id)).toEqual([1, 4, 3, 2])
    const rank = formCategoryRanks(rows)
    expect([rank(1), rank(4), rank(3), rank(2)]).toEqual([0, 1, 2, 3])
    expect(rank(null)).toBeGreaterThan(rank(2))
  })

  it('names the spot of a template', () => {
    expect(formCategorySpot(rows, 3)).toEqual({ categoryId: 1, subcategoryId: 3, path: 'Kinder › Krippe' })
    expect(formCategorySpot(rows, 2)).toEqual({ categoryId: 2, subcategoryId: null, path: 'Team' })
    expect(formCategorySpot(rows, null)).toEqual({ categoryId: null, subcategoryId: null, path: null })
    expect(formCategorySpot(rows, 99).path).toBeNull()
  })

  it('compares names regardless of case, spaces and ß', () => {
    expect(foldFormCategoryName(' Unfälle ')).toBe(foldFormCategoryName('UNFÄLLE'))
    expect(foldFormCategoryName('Maß')).toBe(foldFormCategoryName('mass'))
  })

  it('groups the choices of a picker by category in the order given', () => {
    expect(groupTemplateChoices([
      { id: 1, name: 'A', category: 'Kinder' }, { id: 2, name: 'B', category: 'Kinder › Krippe' }, { id: 3, name: 'C', category: 'Kinder' },
      { id: 4, name: 'D', category: null },
    ])).toEqual([
      { heading: 'Kinder', choices: [{ id: 1, name: 'A', category: 'Kinder' }, { id: 3, name: 'C', category: 'Kinder' }] },
      { heading: 'Kinder › Krippe', choices: [{ id: 2, name: 'B', category: 'Kinder › Krippe' }] },
      { heading: null, choices: [{ id: 4, name: 'D', category: null }] },
    ])
  })
})
