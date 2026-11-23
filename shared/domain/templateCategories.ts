import type { Role } from '../types/api'

/**
 * Who sees a category of print templates and the templates in it: everyone who opens the templates (Leitung, Träger,
 * the tablet and Mitarbeiter accounts), only Leitung and Träger, or only the Träger.
 */
export const TEMPLATE_VISIBILITIES = ['all', 'managers', 'provider'] as const
export type TemplateVisibility = typeof TEMPLATE_VISIBILITIES[number]

/** The widest visibility a role sees: the Träger everything, the Leitung all but the Träger's, everyone else 'all'. */
export function templateViewLevel(role: Role): TemplateVisibility {
  if (role === 'provider') return 'provider'
  if (role === 'admin') return 'managers'
  return 'all'
}

/** The visibilities a viewer of the role sees, in catalog order. */
export function visibleTemplateLevels(role: Role): TemplateVisibility[] {
  return TEMPLATE_VISIBILITIES.slice(0, TEMPLATE_VISIBILITIES.indexOf(templateViewLevel(role)) + 1)
}

/** Whether a viewer of the role sees a category of that visibility. */
export function seesTemplateCategory(role: Role, visibility: TemplateVisibility): boolean {
  return visibleTemplateLevels(role).includes(visibility)
}

/** The stricter of the visibilities (the fewest people see it): what applies where several settings meet. */
export function stricterVisibility(...visibilities: TemplateVisibility[]): TemplateVisibility {
  return visibilities.reduce<TemplateVisibility>(
    (strictest, visibility) => (TEMPLATE_VISIBILITIES.indexOf(visibility) > TEMPLATE_VISIBILITIES.indexOf(strictest) ? visibility : strictest),
    'all',
  )
}

// ---- one level of subcategories (print templates and „Wissen“) ---------------

/**
 * A category of a facility as both the print templates and „Wissen“ keep them: a category (`parentId` null) or a
 * subcategory of one (one level only), in `sortOrder` among its siblings.
 */
export interface CategoryNode {
  id: number
  parentId: number | null
  name: string
  sortOrder: number
  visibility: TemplateVisibility
}

/** Names that differ only in case (umlauts included), surrounding spaces or ß/ss count as the same. */
export const foldCategoryName = (name: string): string => name.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')

const bySortOrder = (a: CategoryNode, b: CategoryNode) => a.sortOrder - b.sortOrder || a.id - b.id

/** The categories in the order they show: each category (in its order) followed by its subcategories (in theirs). */
export function categoriesInTreeOrder<C extends CategoryNode>(rows: readonly C[]): C[] {
  const children = (parentId: number) => rows.filter(row => row.parentId === parentId).sort(bySortOrder)
  return rows.filter(row => row.parentId === null).sort(bySortOrder).flatMap(top => [top, ...children(top.id)])
}

/**
 * Where an item shows in a facility: its category (null = „Vom Träger“, an item for all facilities whose category name
 * the facility has no category of) and its subcategory there (null = directly in the category, „Allgemein“).
 */
export interface CategorySpot<C extends CategoryNode> {
  category: C | null
  subcategory: C | null
}

/** The visibilities that apply at the spot: the category's and the subcategory's (the stricter wins). */
export const spotVisibilities = <C extends CategoryNode>(spot: CategorySpot<C>): TemplateVisibility[] =>
  [spot.category?.visibility, spot.subcategory?.visibility].filter((value): value is TemplateVisibility => value !== undefined)

/** Whether someone of the role sees all of the visibilities. */
export const seesAll = (role: Role, visibilities: readonly TemplateVisibility[]): boolean =>
  visibilities.every(visibility => seesTemplateCategory(role, visibility))

/** Whether someone of the role sees the category: for a subcategory also its category (the stricter wins). */
export function seesCategoryNode<C extends CategoryNode>(role: Role, row: C, rows: readonly C[]): boolean {
  const parent = row.parentId === null ? undefined : rows.find(other => other.id === row.parentId)
  return seesTemplateCategory(role, row.visibility) && (!parent || seesTemplateCategory(role, parent.visibility))
}

/**
 * Finds the spots of a facility's items: by the category row an own item is filed in (a category or a subcategory), or
 * for an item for all facilities by the names the Träger chose – the facility's category of that name (regardless of
 * case, the first in the order when twins from before exist), there its subcategory of that name, else directly in
 * the category; without such a category „Vom Träger“.
 */
export function categoryPlacer<C extends CategoryNode>(rows: readonly C[]) {
  const ordered = categoriesInTreeOrder(rows)
  const byId = new Map(ordered.map(row => [row.id, row]))
  const topByName = new Map<string, C>()
  const subByName = new Map<string, C>()
  for (const row of ordered) {
    const names = row.parentId === null ? topByName : subByName
    const key = row.parentId === null ? foldCategoryName(row.name) : `${row.parentId}:${foldCategoryName(row.name)}`
    if (!names.has(key)) names.set(key, row)
  }
  return {
    /** The spot of an own item filed in that category row; null when the row is not the facility's. */
    byId(id: number | null): CategorySpot<C> | null {
      const row = id === null ? undefined : byId.get(id)
      if (!row) return null
      if (row.parentId === null) return { category: row, subcategory: null }
      const parent = byId.get(row.parentId)
      return parent ? { category: parent, subcategory: row } : null
    },
    /** The spot of an item for all facilities filed by category name and (optional) subcategory name. */
    byName(categoryName: string | null, subcategoryName: string | null): CategorySpot<C> {
      const category = topByName.get(foldCategoryName(categoryName ?? '')) ?? null
      const subcategory = category && subcategoryName ? subByName.get(`${category.id}:${foldCategoryName(subcategoryName)}`) ?? null : null
      return { category, subcategory }
    },
  }
}

/**
 * The order of spots: by category (in the facility's order, „Vom Träger“ last), within a category first the items
 * directly in it („Allgemein“), then by subcategory (in its order).
 */
export function compareSpots<C extends CategoryNode>(a: CategorySpot<C>, b: CategorySpot<C>): number {
  const rank = (row: C | null, missing: number) => (row ? [row.sortOrder, row.id] : [missing, 0])
  const [aTop, aTopId] = rank(a.category, Infinity)
  const [bTop, bTopId] = rank(b.category, Infinity)
  const [aSub, aSubId] = rank(a.subcategory, -Infinity)
  const [bSub, bSubId] = rank(b.subcategory, -Infinity)
  const compare = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1)
  return compare(aTop!, bTop!) || compare(aTopId!, bTopId!) || compare(aSub!, bSub!) || compare(aSubId!, bSubId!)
}

/** The spot's name to show: „Kategorie › Unterkategorie“ (or the category alone). */
export const categoryPath = (category: string, subcategory: string | null | undefined): string =>
  (subcategory ? `${category} › ${subcategory}` : category)

/**
 * The new order of the siblings when one moves a place up or down among those the actor sees (hidden ones keep their
 * places); null when it is at the end already. `siblings` in their order.
 */
export function swappedSiblings<C extends CategoryNode>(siblings: readonly C[], visible: readonly C[], id: number, direction: 'up' | 'down'): C[] | null {
  const at = visible.findIndex(row => row.id === id)
  const self = visible[at]
  const neighbour = visible[direction === 'up' ? at - 1 : at + 1]
  if (!self || !neighbour) return null
  return siblings.map(row => (row.id === self.id ? neighbour : row.id === neighbour.id ? self : row))
}

/** A category name and the subcategory names under it, to offer the Träger for an item for all facilities. */
export interface CategoryNameEntry { name: string; subcategories: string[] }

/**
 * Every category name and, under it, every subcategory name the facilities use or items for all facilities carry, once
 * regardless of case (the first spelling wins), alphabetical. `rows` as the facilities keep them (`parentName` the
 * category of a subcategory), `filed` the names the items for all facilities carry.
 */
export function categoryNameList(
  rows: readonly { name: string; parentName: string | null }[], filed: readonly { name: string | null; subcategoryName: string | null }[],
): CategoryNameEntry[] {
  const tops = new Map<string, { name: string; subs: Map<string, string> }>()
  const top = (name: string) => {
    const key = foldCategoryName(name)
    if (key === '') return undefined
    if (!tops.has(key)) tops.set(key, { name: name.trim(), subs: new Map() })
    return tops.get(key)!
  }
  const sub = (parent: string, name: string | null) => {
    const entry = top(parent)
    const key = foldCategoryName(name ?? '')
    if (entry && key !== '' && !entry.subs.has(key)) entry.subs.set(key, name!.trim())
  }
  for (const row of rows) {
    if (row.parentName === null) top(row.name)
    else sub(row.parentName, row.name)
  }
  for (const item of filed) {
    top(item.name ?? '')
    sub(item.name ?? '', item.subcategoryName)
  }
  const alphabetical = (a: string, b: string) => a.localeCompare(b, 'de')
  return [...tops.values()].map(entry => ({ name: entry.name, subcategories: [...entry.subs.values()].sort(alphabetical) }))
    .sort((a, b) => alphabetical(a.name, b.name))
}
