import type { FormKind } from './forms'

/**
 * The facility's own categories of the form templates (Dokumente → Bögen, server/services/formTemplateCategories.ts),
 * with one level of subcategories, like the categories of the Vorlagen. „Wofür“ (the kind) stays an attribute of each
 * template; the pickers filter by kind and group by category. The rules both sides share.
 */

/** At most this long: a category's name. */
export const FORM_CATEGORY_NAME_MAX = 60

/**
 * The example categories every facility starts with (migration 0128 for the existing ones, the starter seeding for new
 * ones), named like the former groups of the kinds; a template is filed into the one of its kind.
 */
export const EXAMPLE_FORM_CATEGORIES: readonly { kind: FormKind; name: string }[] = [
  { kind: 'child', name: 'Kinder' },
  { kind: 'staff', name: 'Fachkräfte' },
  { kind: 'team', name: 'Team' },
  { kind: 'accident', name: 'Unfälle' },
  { kind: 'info', name: 'Infogespräche' },
  { kind: 'applicant', name: 'Hospitationen' },
]

/** The marker in form_starter_seeds that the facility was given the example categories (so deleted ones stay gone). */
export const FORM_CATEGORY_SEED_KEY = 'categories'

/** Names that differ only in case (umlauts included), surrounding spaces or ß/ss count as the same. */
export const foldFormCategoryName = (name: string): string => name.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')

export interface FormCategoryNode {
  id: number
  parentId: number | null
  name: string
  sortOrder: number
}

const bySortOrder = (a: FormCategoryNode, b: FormCategoryNode) => a.sortOrder - b.sortOrder || a.id - b.id

/** The categories in the order they show: each category (in its order) followed by its subcategories (in theirs). */
export function formCategoriesInTreeOrder<C extends FormCategoryNode>(rows: readonly C[]): C[] {
  const children = (parentId: number) => rows.filter(row => row.parentId === parentId).sort(bySortOrder)
  return rows.filter(row => row.parentId === null).sort(bySortOrder).flatMap(top => [top, ...children(top.id)])
}

/** Where a template is filed: its category (the top one) and subcategory, and the path „Kategorie › Unterkategorie“. */
export interface FormCategorySpot {
  categoryId: number | null
  subcategoryId: number | null
  path: string | null
}

/** The spot of a template filed in `id` (a category or a subcategory; null or unknown = none). */
export function formCategorySpot(categories: readonly FormCategoryNode[], id: number | null): FormCategorySpot {
  const row = id === null ? undefined : categories.find(category => category.id === id)
  if (!row) return { categoryId: null, subcategoryId: null, path: null }
  if (row.parentId === null) return { categoryId: row.id, subcategoryId: null, path: row.name }
  const parent = categories.find(category => category.id === row.parentId)
  return { categoryId: row.parentId, subcategoryId: row.id, path: parent ? `${parent.name} › ${row.name}` : row.name }
}

/**
 * The rank of each category in the tree order (for sorting templates by where they are filed); templates without a
 * category come after all of them.
 */
export function formCategoryRanks(categories: readonly FormCategoryNode[]): (id: number | null) => number {
  const ranks = new Map(formCategoriesInTreeOrder(categories).map((row, index) => [row.id, index]))
  return id => (id === null ? Number.MAX_SAFE_INTEGER : ranks.get(id) ?? Number.MAX_SAFE_INTEGER)
}

/** A template to pick (child forms, staff talks, team meetings, accidents, visits), with where it is filed. */
export interface TemplateChoice {
  id: number
  name: string
  /** „Kategorie › Unterkategorie“; null without a category. */
  category: string | null
}

/**
 * The choices grouped by their path in the order they come (the server's: by category, then by order). Those without a
 * category form one group: headed `noneHeading` („Ohne Kategorie“) when another group has a heading (so they do not look
 * like part of the group above), else without a heading (`heading` null).
 */
export function groupTemplateChoices<T extends TemplateChoice>(
  choices: readonly T[], noneHeading: string | null = null,
): { heading: string | null; choices: T[] }[] {
  const groups: { heading: string | null; choices: T[] }[] = []
  for (const choice of choices) {
    const group = groups.find(entry => entry.heading === choice.category)
    if (group) group.choices.push(choice)
    else groups.push({ heading: choice.category, choices: [choice] })
  }
  if (!groups.some(group => group.heading !== null)) return groups
  return groups.map(group => (group.heading === null ? { ...group, heading: noneHeading } : group))
}

/**
 * The kind a new template in a category starts with: the kind of the example category of that name (Kinder → child …,
 * EXAMPLE_FORM_CATEGORIES, regardless of case); null for any other category (the kind must then be picked).
 */
export function exampleKindOf(categoryName: string | null | undefined): FormKind | null {
  if (!categoryName) return null
  return EXAMPLE_FORM_CATEGORIES.find(entry => foldFormCategoryName(entry.name) === foldFormCategoryName(categoryName))?.kind ?? null
}
