import { and, asc, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { reachesAudience } from '../../shared/domain/documentTargets'
import { can } from '../../shared/domain/permissions'
import {
  categoriesInTreeOrder, categoryNameList, categoryPlacer, foldCategoryName, seesAll, seesCategoryNode, spotVisibilities,
  swappedSiblings, visibleTemplateLevels, type TemplateVisibility,
} from '../../shared/domain/templateCategories'
import type { CategoryNameDto, Role, SessionUser, TemplateCategoryDto, TemplateCategoryInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { printTemplates, templateCategories } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadTargets } from './documentTargets'

/**
 * The categories of the print templates, one list per facility (each facility orders, names and adds its own), with one
 * level of subcategories: a subcategory belongs to a category of the same facility, never to another subcategory.
 * Whoever holds printTemplates.edit (Leitung and Träger by default, a Mitarbeiter with the bundle „Vorlagen bearbeiten“)
 * maintains those of the facility they work in, each only those they see (by role; a subcategory only with its
 * category): a category for the Träger alone is the Träger's to create, change and delete, and a Leitung can neither
 * see it (404) nor give a category that visibility (403); a Mitarbeiter only those visible to all. Another facility's
 * category is 404 as well.
 */
export type CategoryActor = Pick<SessionUser, 'role' | 'permissions'> & { facilityId: number }

/** Who looks at a facility's categories: the role decides which they see, the home group which Träger templates count. */
export type CategoryViewer = Pick<SessionUser, 'role'> & { facilityId: number; homeGroupId?: number | null }

type CategoryRow = typeof templateCategories.$inferSelect

/** The facility's categories, each category followed by its subcategories, in their order (ties by id). */
export const facilityCategories = (db: Db, facilityId: number): CategoryRow[] =>
  categoriesInTreeOrder(db.select().from(templateCategories).where(eq(templateCategories.facilityId, facilityId))
    .orderBy(asc(templateCategories.sortOrder), asc(templateCategories.id)).all())

/** Names that differ only in case (umlauts included) or in ß/ss count as the same; as in 0063_template_categories. */
export const comparableCategoryName = foldCategoryName

/**
 * The categories and subcategories of the viewer's facility they see (a subcategory only when they see its category
 * too), each category followed by its subcategories, with how many of the facility's own templates are filed directly
 * in each and how many of the Träger's templates for all facilities (that the viewer sees) show directly in each by
 * name. A name shared by twins from before the categories counts for the first of them, as the templates show there.
 */
export function listCategories(db: Db, viewer: CategoryViewer): TemplateCategoryDto[] {
  const all = facilityCategories(db, viewer.facilityId)
  const rows = all.filter(row => seesCategoryNode(viewer.role, row, all))
  const counts = new Map(rows.length === 0 ? [] : db.select({ id: printTemplates.categoryId, n: count() }).from(printTemplates)
    .where(inArray(printTemplates.categoryId, rows.map(row => row.id))).groupBy(printTemplates.categoryId).all()
    .map(row => [row.id, row.n]))
  const place = categoryPlacer(all)
  const globalCounts = new Map<number, number>()
  const globals = db.select({
    id: printTemplates.id, name: printTemplates.categoryName, subcategoryName: printTemplates.subcategoryName,
    visibility: printTemplates.visibility, allFacilities: printTemplates.allFacilities,
  }).from(printTemplates).where(isNull(printTemplates.facilityId)).all()
  // Only those for this facility („Gilt für“) whose groups allow the viewer.
  const targets = loadTargets(db, 'template', globals)
  const audience = { role: viewer.role, homeGroupId: viewer.homeGroupId ?? null }
  for (const global of globals) {
    const spot = place.byName(global.name, global.subcategoryName)
    const shownIn = spot.subcategory ?? spot.category
    const itemTargets = targets.get(global.id)
    if (!itemTargets || !reachesAudience(itemTargets, viewer.facilityId, audience)) continue
    if (shownIn && seesAll(viewer.role, [global.visibility, ...spotVisibilities(spot)])) {
      globalCounts.set(shownIn.id, (globalCounts.get(shownIn.id) ?? 0) + 1)
    }
  }
  return rows.map(row => ({
    id: row.id, parentId: row.parentId, name: row.name, visibility: row.visibility,
    templateCount: counts.get(row.id) ?? 0, globalCount: globalCounts.get(row.id) ?? 0,
    hiddenSubcategories: all.filter(child => child.parentId === row.id && !seesCategoryNode(viewer.role, child, all)).length,
  }))
}

/**
 * The category or subcategory of a facility's template as the viewer chooses it: one of the facility they see (a
 * subcategory with its category), else 400 template_category_invalid.
 */
export function chosenCategory(db: Db, role: Role, facilityId: number, id: number | null | undefined): CategoryRow {
  const all = id == null ? [] : facilityCategories(db, facilityId)
  const row = all.find(category => category.id === id)
  if (!row || !seesCategoryNode(role, row, all)) throw new ServiceError(400, 'template_category_invalid')
  return row
}

function assertEditor(actor: Pick<CategoryActor, 'permissions'>): void {
  if (!can(actor.permissions, 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
}

/** A category the actor maintains: one of their facility they see (else 404 template_category_not_found). */
function loadEditable(db: Db, actor: CategoryActor, id: number): { row: CategoryRow; all: CategoryRow[] } {
  assertEditor(actor)
  const all = facilityCategories(db, actor.facilityId)
  const row = all.find(category => category.id === id)
  if (!row || !seesCategoryNode(actor.role, row, all)) throw new ServiceError(404, 'template_category_not_found')
  return { row, all }
}

/** The trimmed category name (at most 60 characters); an empty one is 400 template_category_name_required. */
export function checkedCategoryName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ServiceError(400, 'template_category_name_required')
  return trimmed.slice(0, 60)
}

/**
 * The trimmed name, unique regardless of case among its siblings (the facility's categories, or the subcategories of
 * the same category; also those the actor does not see). A category keeping its own name is never a clash, even beside
 * a twin from before the categories.
 */
function checkedInput(
  actor: CategoryActor, all: readonly CategoryRow[], input: TemplateCategoryInput, parentId: number | null, current: CategoryRow | null,
): { name: string; visibility: TemplateVisibility } {
  const name = checkedCategoryName(input.name)
  if (!visibleTemplateLevels(actor.role).includes(input.visibility)) throw new ServiceError(403, 'forbidden')
  if (name !== current?.name) {
    const clash = all.some(row => row.id !== current?.id && row.parentId === parentId && comparableCategoryName(row.name) === comparableCategoryName(name))
    if (clash) throw new ServiceError(409, 'template_category_name_taken')
  }
  return { name, visibility: input.visibility }
}

/**
 * A new category at the end of the facility's list, or with `parentId` a new subcategory at the end of that category's
 * (a category of the facility the actor sees, not itself a subcategory: else 400 template_category_parent_invalid);
 * returns its id.
 */
export function createCategory(db: Db, actor: CategoryActor, input: TemplateCategoryInput): number {
  assertEditor(actor)
  const all = facilityCategories(db, actor.facilityId)
  const parentId = input.parentId ?? null
  if (parentId !== null) {
    const parent = all.find(row => row.id === parentId)
    if (!parent || parent.parentId !== null || !seesCategoryNode(actor.role, parent, all)) {
      throw new ServiceError(400, 'template_category_parent_invalid')
    }
  }
  const values = checkedInput(actor, all, input, parentId, null)
  const last = all.filter(row => row.parentId === parentId).at(-1)
  return db.insert(templateCategories).values({ ...values, facilityId: actor.facilityId, parentId, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: templateCategories.id }).get().id
}

/** Renames the category and changes who sees it (and its templates); where it sits (category or subcategory) stays. */
export function updateCategory(db: Db, actor: CategoryActor, id: number, input: TemplateCategoryInput): void {
  const { row, all } = loadEditable(db, actor, id)
  db.update(templateCategories).set(checkedInput(actor, all, input, row.parentId, row)).where(eq(templateCategories.id, id)).run()
}

/**
 * Swaps the category with its neighbour among its siblings the actor sees (the facility's categories, or the
 * subcategories of the same category; the Leitung's list skips the Träger's hidden ones); at an end nothing changes.
 * The siblings are numbered afresh.
 */
export function moveCategory(db: Db, actor: CategoryActor, id: number, direction: 'up' | 'down'): void {
  const { row, all } = loadEditable(db, actor, id)
  const siblings = all.filter(other => other.parentId === row.parentId)
  const swapped = swappedSiblings(siblings, siblings.filter(other => seesCategoryNode(actor.role, other, all)), id, direction)
  if (!swapped) return
  db.transaction((tx) => {
    swapped.forEach((sibling, index) => {
      if (sibling.sortOrder !== index) tx.update(templateCategories).set({ sortOrder: index }).where(eq(templateCategories.id, sibling.id)).run()
    })
  })
}

/**
 * Deletes an empty category: one with subcategories is 409 template_category_has_subcategories, one holding templates of
 * the facility 409 template_category_not_empty. Templates for all facilities filed under its name do not count: they
 * move to „Vom Träger“ (from a subcategory: directly into its category).
 */
export function deleteCategory(db: Db, actor: CategoryActor, id: number): void {
  const { all } = loadEditable(db, actor, id)
  if (all.some(row => row.parentId === id)) throw new ServiceError(409, 'template_category_has_subcategories')
  const used = db.select({ id: printTemplates.id }).from(printTemplates).where(eq(printTemplates.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'template_category_not_empty')
  db.delete(templateCategories).where(eq(templateCategories.id, id)).run()
}

/**
 * The category names to offer the Träger for a template for all facilities (printTemplates.global, else 403): every
 * name a facility uses or a template for all facilities carries, once regardless of case, alphabetical, each with the
 * subcategory names under it.
 */
export function globalCategoryNames(db: Db, actor: Pick<SessionUser, 'permissions'>): CategoryNameDto[] {
  if (!can(actor.permissions, 'printTemplates.global')) throw new ServiceError(403, 'forbidden')
  const rows = db.select({ id: templateCategories.id, parentId: templateCategories.parentId, name: templateCategories.name })
    .from(templateCategories)
    .orderBy(asc(templateCategories.facilityId), asc(templateCategories.sortOrder), asc(templateCategories.id)).all()
  const names = new Map(rows.map(row => [row.id, row.name]))
  const filed = db.select({ name: printTemplates.categoryName, subcategoryName: printTemplates.subcategoryName }).from(printTemplates)
    .where(and(isNull(printTemplates.facilityId), isNotNull(printTemplates.categoryName))).all()
  return categoryNameList(rows.map(row => ({ name: row.name, parentName: row.parentId === null ? null : names.get(row.parentId) ?? null })), filed)
}
