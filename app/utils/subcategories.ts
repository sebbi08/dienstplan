import { foldCategoryName } from '#shared/domain/templateCategories'
import type { CategoryNameDto } from '#shared/types/api'

/**
 * The second row of small tabs on a category's sub-tab of „Dokumente“ → „Vorlagen“ and „Wissen“ (one level of
 * subcategories): „Alle“, „Allgemein“ (the items directly in the category, only when there are any) and the
 * subcategories in their order. „Alle“ shows the items in groups, one per subcategory; the arrows (▲/▼) order within
 * each group, which is the same list a subcategory's own small tab shows.
 */

/** A category or subcategory as the server lists them (each category followed by its subcategories). */
export interface TreeCategory {
  id: number
  parentId: number | null
  name: string
}

/** An item filed in a category (`categoryId`) and maybe one of its subcategories (`subcategoryId`). */
export interface FiledItem {
  categoryId: number | null
  subcategoryId: number | null
}

/** The small tab „Alle“ (all groups) and „Allgemein“ (the items directly in the category). */
export const ALL_CHIP = 'all'
export const GENERAL_CHIP = 'general'

/** The key of a subcategory's small tab. */
export const subcategoryChip = (id: number): string => `sub-${id}`

/** The categories without their subcategories, in their order. */
export const topCategories = <C extends TreeCategory>(categories: readonly C[]): C[] => categories.filter(category => category.parentId === null)

/** The subcategories of a category, in their order. */
export const subcategoriesOf = <C extends TreeCategory>(categories: readonly C[], parentId: number | null): C[] =>
  (parentId === null ? [] : categories.filter(category => category.parentId === parentId))

/**
 * One list of a category's sub-tab: the items directly in it (`subcategory` null, „Allgemein“) or those of one
 * subcategory. `groupId` is what the server orders it by: the subcategory's id, else the category's (null for „Vom
 * Träger“).
 */
export interface ItemGroup<C extends TreeCategory, T> {
  key: string
  subcategory: C | null
  groupId: number | null
  items: T[]
}

/**
 * The lists of a sub-tab: first the items directly in the category, then one per subcategory in their order (also
 * empty ones). The items keep the order they come in (the server's).
 */
export function itemGroups<C extends TreeCategory, T extends FiledItem>(
  category: C | null, subcategories: readonly C[], items: readonly T[],
): ItemGroup<C, T>[] {
  return [
    { key: GENERAL_CHIP, subcategory: null, groupId: category?.id ?? null, items: items.filter(item => item.subcategoryId === null) },
    ...subcategories.map(subcategory => ({
      key: subcategoryChip(subcategory.id), subcategory, groupId: subcategory.id,
      items: items.filter(item => item.subcategoryId === subcategory.id),
    })),
  ]
}

/** A small tab of the second row. */
export interface SubChip { key: string; subcategory: TreeCategory | null }

/**
 * The small tabs of a sub-tab: none for a category without subcategories (and „Vom Träger“); else „Alle“, „Allgemein“
 * when items lie directly in the category, and every subcategory.
 */
export function subChips<C extends TreeCategory, T>(groups: readonly ItemGroup<C, T>[]): SubChip[] {
  if (groups.length < 2) return []
  const general = groups[0]!
  return [
    { key: ALL_CHIP, subcategory: null },
    ...(general.items.length > 0 ? [{ key: GENERAL_CHIP, subcategory: null }] : []),
    ...groups.slice(1).map(group => ({ key: group.key, subcategory: group.subcategory })),
  ]
}

/** The small tab to open: the one asked for (or remembered) when it is there, else „Alle“ (null without small tabs). */
export function chosenChip(chips: readonly SubChip[], wanted: string | null | undefined): string | null {
  return chips.find(chip => chip.key === wanted)?.key ?? chips[0]?.key ?? null
}

/**
 * The lists to show for the small tab: all of them for „Alle“ (empty ones left out, the category's own first), else the
 * one chosen (also when empty). Without small tabs the one list there is.
 */
export function shownGroups<C extends TreeCategory, T>(groups: readonly ItemGroup<C, T>[], chip: string | null): ItemGroup<C, T>[] {
  if (chip === null) return groups.slice(0, 1)
  if (chip === ALL_CHIP) return groups.filter(group => group.items.length > 0)
  return groups.filter(group => group.key === chip)
}

/** Whether the shown lists carry headings: in „Alle“, where the groups stand one below the other. */
export const groupHeadings = (chip: string | null): boolean => chip === ALL_CHIP

/** The small tab each sub-tab had open last on this device, by the sub-tab's key; empty when storage is unavailable. */
export function readChipMemory(storageKey: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {}
  }
  catch {
    return {}
  }
}

export function writeChipMemory(storageKey: string, tabKey: string, chip: string): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...readChipMemory(storageKey), [tabKey]: chip }))
  }
  catch {
    // Not remembered; switching still works on this page.
  }
}

/**
 * The subcategory choices of an upload or edit form: „Allgemein (keine Unterkategorie)“ as 0, then the subcategories
 * of the chosen category.
 */
export function subcategoryItems(categories: readonly TreeCategory[], categoryId: number | undefined, noneLabel: string) {
  return [{ label: noneLabel, value: 0 }, ...subcategoriesOf(categories, categoryId ?? null).map(sub => ({ label: sub.name, value: sub.id }))]
}

/** The category row an item is filed in: the subcategory chosen (not 0), else the category. */
export const filedCategoryId = (categoryId: number | undefined, subcategoryId: number): number | undefined =>
  (categoryId === undefined ? undefined : subcategoryId > 0 ? subcategoryId : categoryId)

/** The subcategory names under the typed category name (regardless of case), to offer the Träger. */
export function subcategoryNamesFor(names: readonly CategoryNameDto[], categoryName: string): string[] {
  return names.find(entry => foldCategoryName(entry.name) === foldCategoryName(categoryName))?.subcategories ?? []
}
