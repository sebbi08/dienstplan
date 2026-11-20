import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm'
import { can } from '../../shared/domain/permissions'
import { seesTemplateCategory, visibleTemplateLevels, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { Role, SessionUser, TemplateCategoryDto, TemplateCategoryInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { printTemplates, templateCategories } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * The categories of the print templates, one list per facility (each facility orders, names and adds its own). Whoever
 * holds printTemplates.edit (Leitung and Träger by default, a Mitarbeiter with the bundle „Vorlagen bearbeiten“)
 * maintains those of the facility they work in, each only those they see (by role): a category for the Träger alone is
 * the Träger's to create, change and delete, and a Leitung can neither see it (404) nor give a category that visibility
 * (403); a Mitarbeiter only those visible to all. Another facility's category is 404 as well.
 */
export type CategoryActor = Pick<SessionUser, 'role' | 'permissions'> & { facilityId: number }

/** Who looks at a facility's categories: the role decides which they see. */
export type CategoryViewer = Pick<SessionUser, 'role'> & { facilityId: number }

type CategoryRow = typeof templateCategories.$inferSelect

/** The facility's categories in their order (ties by id). */
export const facilityCategories = (db: Db, facilityId: number): CategoryRow[] =>
  db.select().from(templateCategories).where(eq(templateCategories.facilityId, facilityId))
    .orderBy(asc(templateCategories.sortOrder), asc(templateCategories.id)).all()

/** Names that differ only in case (umlauts included) or in ß/ss count as the same; as in 0063_template_categories. */
export const comparableCategoryName = (name: string) => name.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')

/**
 * The categories of the viewer's facility they see, in their order, with how many of the facility's own templates are
 * filed in them.
 */
export function listCategories(db: Db, viewer: CategoryViewer): TemplateCategoryDto[] {
  const rows = facilityCategories(db, viewer.facilityId).filter(row => seesTemplateCategory(viewer.role, row.visibility))
  const counts = new Map(rows.length === 0 ? [] : db.select({ id: printTemplates.categoryId, n: count() }).from(printTemplates)
    .where(inArray(printTemplates.categoryId, rows.map(row => row.id))).groupBy(printTemplates.categoryId).all()
    .map(row => [row.id, row.n]))
  return rows.map(row => ({ id: row.id, name: row.name, visibility: row.visibility, templateCount: counts.get(row.id) ?? 0 }))
}

/** The category of a facility's template as the viewer chooses it: one of the facility they see, else 400 template_category_invalid. */
export function chosenCategory(db: Db, role: Role, facilityId: number, id: number | null | undefined): CategoryRow {
  const row = id == null
    ? undefined
    : db.select().from(templateCategories).where(and(eq(templateCategories.id, id), eq(templateCategories.facilityId, facilityId))).get()
  if (!row || !seesTemplateCategory(role, row.visibility)) throw new ServiceError(400, 'template_category_invalid')
  return row
}

function assertEditor(actor: Pick<CategoryActor, 'permissions'>): void {
  if (!can(actor.permissions, 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
}

/** A category the actor maintains: one of their facility they see (else 404 template_category_not_found). */
function loadEditable(db: Db, actor: CategoryActor, id: number): CategoryRow {
  assertEditor(actor)
  const row = db.select().from(templateCategories)
    .where(and(eq(templateCategories.id, id), eq(templateCategories.facilityId, actor.facilityId))).get()
  if (!row || !seesTemplateCategory(actor.role, row.visibility)) throw new ServiceError(404, 'template_category_not_found')
  return row
}

/** The trimmed category name (at most 60 characters); an empty one is 400 template_category_name_required. */
export function checkedCategoryName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ServiceError(400, 'template_category_name_required')
  return trimmed.slice(0, 60)
}

/**
 * The trimmed name, unique regardless of case among the facility's categories (also those the actor does not see). A
 * category keeping its own name is never a clash, even beside a twin from before the categories.
 */
function checkedInput(
  db: Db, actor: CategoryActor, input: TemplateCategoryInput, current: CategoryRow | null,
): { name: string; visibility: TemplateVisibility } {
  const name = checkedCategoryName(input.name)
  if (!visibleTemplateLevels(actor.role).includes(input.visibility)) throw new ServiceError(403, 'forbidden')
  if (name !== current?.name) {
    const clash = facilityCategories(db, actor.facilityId)
      .some(row => row.id !== current?.id && comparableCategoryName(row.name) === comparableCategoryName(name))
    if (clash) throw new ServiceError(409, 'template_category_name_taken')
  }
  return { name, visibility: input.visibility }
}

/** A new category at the end of the facility's list; returns its id. */
export function createCategory(db: Db, actor: CategoryActor, input: TemplateCategoryInput): number {
  assertEditor(actor)
  const values = checkedInput(db, actor, input, null)
  const last = facilityCategories(db, actor.facilityId).at(-1)
  return db.insert(templateCategories).values({ ...values, facilityId: actor.facilityId, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: templateCategories.id }).get().id
}

/** Renames the category and changes who sees it (and its templates). */
export function updateCategory(db: Db, actor: CategoryActor, id: number, input: TemplateCategoryInput): void {
  const current = loadEditable(db, actor, id)
  db.update(templateCategories).set(checkedInput(db, actor, input, current)).where(eq(templateCategories.id, id)).run()
}

/**
 * Swaps the category with its neighbour among those the actor sees (the Leitung's list skips the Träger's hidden
 * ones); at an end nothing changes. The facility's whole list is numbered afresh.
 */
export function moveCategory(db: Db, actor: CategoryActor, id: number, direction: 'up' | 'down'): void {
  loadEditable(db, actor, id)
  const all = facilityCategories(db, actor.facilityId)
  const visible = all.filter(row => seesTemplateCategory(actor.role, row.visibility))
  const at = visible.findIndex(row => row.id === id)
  const self = visible[at]!
  const neighbour = visible[direction === 'up' ? at - 1 : at + 1]
  if (!neighbour) return
  const swapped = all.map(row => (row.id === self.id ? neighbour : row.id === neighbour.id ? self : row))
  db.transaction((tx) => {
    swapped.forEach((row, index) => {
      if (row.sortOrder !== index) tx.update(templateCategories).set({ sortOrder: index }).where(eq(templateCategories.id, row.id)).run()
    })
  })
}

/**
 * Deletes an empty category; one holding templates of the facility is 409 template_category_not_empty. Templates for all
 * facilities filed under its name do not count: they move to „Vom Träger“.
 */
export function deleteCategory(db: Db, actor: CategoryActor, id: number): void {
  loadEditable(db, actor, id)
  const used = db.select({ id: printTemplates.id }).from(printTemplates).where(eq(printTemplates.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'template_category_not_empty')
  db.delete(templateCategories).where(eq(templateCategories.id, id)).run()
}

/**
 * The category names to offer the Träger for a template for all facilities (printTemplates.global, else 403): every
 * name a facility uses or a template for all facilities carries, once regardless of case, alphabetical.
 */
export function globalCategoryNames(db: Db, actor: Pick<SessionUser, 'permissions'>): string[] {
  if (!can(actor.permissions, 'printTemplates.global')) throw new ServiceError(403, 'forbidden')
  const names = [
    ...db.select({ name: templateCategories.name }).from(templateCategories)
      .orderBy(asc(templateCategories.facilityId), asc(templateCategories.sortOrder), asc(templateCategories.id)).all()
      .map(row => row.name),
    ...db.select({ name: printTemplates.categoryName }).from(printTemplates).where(isNotNull(printTemplates.categoryName)).all()
      .map(row => row.name ?? ''),
  ]
  const byName = new Map<string, string>()
  for (const name of names) {
    const key = comparableCategoryName(name)
    if (key !== '' && !byName.has(key)) byName.set(key, name.trim())
  }
  return [...byName.values()].sort((a, b) => a.localeCompare(b, 'de'))
}
