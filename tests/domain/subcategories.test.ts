import { describe, expect, it } from 'vitest'
import {
  ALL_CHIP, GENERAL_CHIP, chosenChip, filedCategoryId, groupHeadings, itemGroups, readChipMemory, shownGroups, subcategoryChip,
  subcategoryItems, subcategoryNamesFor, subChips, writeChipMemory,
} from '../../app/utils/subcategories'
import {
  categoriesInTreeOrder, categoryNameList, categoryPath, categoryPlacer, compareSpots, seesAll, seesCategoryNode, spotVisibilities,
  stricterVisibility, swappedSiblings, type CategoryNode, type TemplateVisibility,
} from '../../shared/domain/templateCategories'

const node = (id: number, parentId: number | null, name: string, sortOrder = 0, visibility: TemplateVisibility = 'all'): CategoryNode =>
  ({ id, parentId, name, sortOrder, visibility })

describe('one level of subcategories (shared rules)', () => {
  it('takes the stricter visibility where category, subcategory and item meet', () => {
    expect(stricterVisibility('all', 'managers')).toBe('managers')
    expect(stricterVisibility('provider', 'all', 'managers')).toBe('provider')
    expect(stricterVisibility()).toBe('all')
    expect(seesAll('observer', ['all', 'all'])).toBe(true)
    expect(seesAll('observer', ['all', 'managers'])).toBe(false)
    expect(seesAll('admin', ['managers', 'all'])).toBe(true)
    expect(seesAll('terminal', [])).toBe(true)
  })

  it('lists each category followed by its subcategories, both in their order', () => {
    const rows = [node(1, null, 'B', 1), node(2, null, 'A', 0), node(3, 1, 'B2', 1), node(4, 1, 'B1', 0), node(5, 2, 'A1', 0)]
    expect(categoriesInTreeOrder(rows).map(row => row.name)).toEqual(['A', 'A1', 'B', 'B1', 'B2'])
  })

  it('shows a subcategory only to who sees it and its category', () => {
    const rows = [node(1, null, 'Intern', 0, 'managers'), node(2, 1, 'Offen', 0, 'all'), node(3, null, 'Offen', 1), node(4, 3, 'Leitung', 0, 'managers')]
    expect(rows.filter(row => seesCategoryNode('observer', row, rows)).map(row => row.id)).toEqual([3])
    expect(rows.filter(row => seesCategoryNode('admin', row, rows)).map(row => row.id)).toEqual([1, 2, 3, 4])
  })

  it('places an own item by its row and an item for all facilities by its path, with the fallbacks', () => {
    const rows = [node(1, null, 'Gesetze'), node(2, 1, 'Bund'), node(3, null, 'Hygiene', 1)]
    const place = categoryPlacer(rows)
    expect(place.byId(2)).toEqual({ category: rows[0], subcategory: rows[1] })
    expect(place.byId(3)).toEqual({ category: rows[2], subcategory: null })
    expect(place.byId(99)).toBeNull()
    expect(place.byId(null)).toBeNull()
    expect(place.byName(' gesetze ', 'BUND')).toEqual({ category: rows[0], subcategory: rows[1] })
    expect(place.byName('Gesetze', 'Land')).toEqual({ category: rows[0], subcategory: null })
    expect(place.byName('Gesetze', null)).toEqual({ category: rows[0], subcategory: null })
    // A subcategory's name does not count as a category's.
    expect(place.byName('Bund', null)).toEqual({ category: null, subcategory: null })
    expect(spotVisibilities(place.byName('Gesetze', 'Bund'))).toEqual(['all', 'all'])
    expect(spotVisibilities({ category: null, subcategory: null })).toEqual([])
  })

  it('orders spots by category, the category\'s own items first, then by subcategory, „Vom Träger“ last', () => {
    const rows = [node(1, null, 'A', 0), node(2, 1, 'A2', 1), node(3, 1, 'A1', 0), node(4, null, 'B', 1)]
    const place = categoryPlacer(rows)
    const spots = [place.byId(4), { category: null, subcategory: null }, place.byId(2), place.byId(1), place.byId(3)].map(spot => spot!)
    const name = (spot: typeof spots[number]) => [spot.category?.name ?? '-', spot.subcategory?.name].filter(Boolean).join('/')
    expect([...spots].sort(compareSpots).map(name)).toEqual(['A', 'A/A1', 'A/A2', 'B', '-'])
    expect(categoryPath('A', 'A1')).toBe('A › A1')
    expect(categoryPath('A', '')).toBe('A')
  })

  it('swaps a sibling with its visible neighbour, hidden ones keep their places', () => {
    const siblings = [node(1, 9, 'A'), node(2, 9, 'Geheim', 1, 'provider'), node(3, 9, 'B', 2)]
    const visible = [siblings[0]!, siblings[2]!]
    expect(swappedSiblings(siblings, visible, 3, 'up')!.map(row => row.name)).toEqual(['B', 'Geheim', 'A'])
    expect(swappedSiblings(siblings, visible, 1, 'up')).toBeNull()
    expect(swappedSiblings(siblings, visible, 3, 'down')).toBeNull()
  })

  it('offers each category name once with the subcategory names under it', () => {
    expect(categoryNameList(
      [{ name: 'Eltern', parentName: null }, { name: 'Briefe', parentName: 'Eltern' }, { name: 'eltern', parentName: null }, { name: 'BRIEFE', parentName: 'eltern' }],
      [{ name: 'Küche', subcategoryName: 'Pläne' }, { name: 'Küche', subcategoryName: null }, { name: ' ', subcategoryName: 'X' }],
    )).toEqual([{ name: 'Eltern', subcategories: ['Briefe'] }, { name: 'Küche', subcategories: ['Pläne'] }])
  })
})

describe('the second row of small tabs', () => {
  const category = { id: 1, parentId: null, name: 'Gesetze' }
  const bund = { id: 11, parentId: 1, name: 'Bund' }
  const land = { id: 12, parentId: 1, name: 'Land' }
  const item = (id: number, subcategoryId: number | null) => ({ id, categoryId: 1, subcategoryId })

  it('makes a list of the category\'s own items, then one per subcategory (also empty ones)', () => {
    const groups = itemGroups(category, [bund, land], [item(1, 11), item(2, null), item(3, 11)])
    expect(groups.map(group => [group.key, group.groupId, group.items.map(entry => entry.id)])).toEqual([
      [GENERAL_CHIP, 1, [2]], [subcategoryChip(11), 11, [1, 3]], [subcategoryChip(12), 12, []],
    ])
    // „Vom Träger“: one list, ordered by null.
    expect(itemGroups(null, [], [{ id: 5, categoryId: null, subcategoryId: null }]).map(group => group.groupId)).toEqual([null])
  })

  it('offers „Alle“, „Allgemein“ (only with own items) and the subcategories; none without subcategories', () => {
    const withGeneral = subChips(itemGroups(category, [bund, land], [item(1, null)]))
    expect(withGeneral.map(chip => chip.key)).toEqual([ALL_CHIP, GENERAL_CHIP, 'sub-11', 'sub-12'])
    expect(subChips(itemGroups(category, [bund], [item(1, 11)])).map(chip => chip.key)).toEqual([ALL_CHIP, 'sub-11'])
    expect(subChips(itemGroups(category, [], [item(1, null)]))).toEqual([])
    expect(chosenChip(withGeneral, 'sub-12')).toBe('sub-12')
    expect(chosenChip(withGeneral, 'sub-99')).toBe(ALL_CHIP)
    expect(chosenChip([], ALL_CHIP)).toBeNull()
  })

  it('shows every non-empty list with headings for „Alle“, else the chosen list (also empty)', () => {
    const groups = itemGroups(category, [bund, land], [item(1, 11), item(2, null)])
    expect(shownGroups(groups, ALL_CHIP).map(group => group.key)).toEqual([GENERAL_CHIP, 'sub-11'])
    expect(shownGroups(groups, 'sub-12').map(group => group.items.length)).toEqual([0])
    expect(shownGroups(groups, null).map(group => group.key)).toEqual([GENERAL_CHIP])
    expect(groupHeadings(ALL_CHIP)).toBe(true)
    expect(groupHeadings('sub-11')).toBe(false)
  })

  it('remembers the small tab per sub-tab on the device, and does without storage', () => {
    expect(readChipMemory('k')).toEqual({})
    expect(() => writeChipMemory('k', 'category-1', 'sub-2')).not.toThrow()
    const store = new Map<string, string>()
    globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } as Storage
    try {
      writeChipMemory('k', 'category-1', 'sub-2')
      writeChipMemory('k', 'category-3', ALL_CHIP)
      expect(readChipMemory('k')).toEqual({ 'category-1': 'sub-2', 'category-3': ALL_CHIP })
      store.set('k', '[1,2]')
      expect(readChipMemory('k')).toEqual({})
      store.set('k', 'kaputt')
      expect(readChipMemory('k')).toEqual({})
    }
    finally {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })

  it('offers the subcategories of the chosen category in the form, „Allgemein“ (0) first', () => {
    expect(subcategoryItems([category, bund, land], 1, 'Allgemein')).toEqual([
      { label: 'Allgemein', value: 0 }, { label: 'Bund', value: 11 }, { label: 'Land', value: 12 },
    ])
    expect(subcategoryItems([category, bund], undefined, 'Allgemein')).toEqual([{ label: 'Allgemein', value: 0 }])
    expect(filedCategoryId(1, 0)).toBe(1)
    expect(filedCategoryId(1, 11)).toBe(11)
    expect(filedCategoryId(undefined, 11)).toBeUndefined()
    expect(subcategoryNamesFor([{ name: 'Gesetze', subcategories: ['Bund'] }], ' GESETZE ')).toEqual(['Bund'])
    expect(subcategoryNamesFor([], 'X')).toEqual([])
  })
})
