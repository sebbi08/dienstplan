import { asc, eq, inArray } from 'drizzle-orm'
import { can } from '../../shared/domain/permissions'
import { seesTemplateCategory, visibleTemplateLevels, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { Role, TemplateCategoryDto, TemplateCategoryInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { printTemplates, templateCategories } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { rolePermissions } from './permissions'

/**
 * The categories of the print templates, one list for every facility. Leitung and Träger maintain them
 * (printTemplates.edit), each only those they see: a category for the Träger alone is the Träger's to create, change and
 * delete, and a Leitung can neither see it (404) nor give a category that visibility (403).
 */
export type CategoryActor = { role: Role }

type CategoryRow = typeof templateCategories.$inferSelect

/** Every category in its order (ties by id). */
const ordered = (db: Db): CategoryRow[] =>
  db.select().from(templateCategories).orderBy(asc(templateCategories.sortOrder), asc(templateCategories.id)).all()

const comparable = (name: string) => name.trim().toLocaleLowerCase('de')

/** The categories the viewer sees, in their order, with whether templates (of any facility) are filed in them. */
export function listCategories(db: Db, viewer: CategoryActor): TemplateCategoryDto[] {
  const rows = ordered(db).filter(row => seesTemplateCategory(viewer.role, row.visibility))
  const used = new Set(rows.length === 0 ? [] : db.selectDistinct({ id: printTemplates.categoryId }).from(printTemplates)
    .where(inArray(printTemplates.categoryId, rows.map(row => row.id))).all().map(row => row.id))
  return rows.map(row => ({ id: row.id, name: row.name, visibility: row.visibility, inUse: used.has(row.id) }))
}

/** The category of a template as the viewer chooses it: one they see, else 400 template_category_invalid. */
export function chosenCategory(db: Db, role: Role, id: number): CategoryRow {
  const row = db.select().from(templateCategories).where(eq(templateCategories.id, id)).get()
  if (!row || !seesTemplateCategory(role, row.visibility)) throw new ServiceError(400, 'template_category_invalid')
  return row
}

function assertEditor(db: Db, actor: CategoryActor): void {
  if (!can(rolePermissions(db, actor.role), 'printTemplates.edit')) throw new ServiceError(403, 'forbidden')
}

/** A category the actor maintains: one they see (else 404 template_category_not_found). */
function loadEditable(db: Db, actor: CategoryActor, id: number): CategoryRow {
  assertEditor(db, actor)
  const row = db.select().from(templateCategories).where(eq(templateCategories.id, id)).get()
  if (!row || !seesTemplateCategory(actor.role, row.visibility)) throw new ServiceError(404, 'template_category_not_found')
  return row
}

/** The trimmed name, unique regardless of case among all categories (also those the actor does not see). */
function checkedInput(db: Db, actor: CategoryActor, input: TemplateCategoryInput, id: number | null): { name: string; visibility: TemplateVisibility } {
  const name = input.name.trim()
  if (name === '') throw new ServiceError(400, 'template_category_name_required')
  if (!visibleTemplateLevels(actor.role).includes(input.visibility)) throw new ServiceError(403, 'forbidden')
  const clash = db.select({ id: templateCategories.id, name: templateCategories.name }).from(templateCategories).all()
    .some(row => row.id !== id && comparable(row.name) === comparable(name))
  if (clash) throw new ServiceError(409, 'template_category_name_taken')
  return { name: name.slice(0, 60), visibility: input.visibility }
}

/** A new category at the end of the list; returns its id. */
export function createCategory(db: Db, actor: CategoryActor, input: TemplateCategoryInput): number {
  assertEditor(db, actor)
  const values = checkedInput(db, actor, input, null)
  const last = ordered(db).at(-1)
  return db.insert(templateCategories).values({ ...values, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: templateCategories.id }).get().id
}

/** Renames the category and changes who sees it (and its templates). */
export function updateCategory(db: Db, actor: CategoryActor, id: number, input: TemplateCategoryInput): void {
  loadEditable(db, actor, id)
  db.update(templateCategories).set(checkedInput(db, actor, input, id)).where(eq(templateCategories.id, id)).run()
}

/**
 * Swaps the category with its neighbour among those the actor sees (the Leitung's list skips the Träger's hidden
 * ones); at an end nothing changes. The whole list is numbered afresh.
 */
export function moveCategory(db: Db, actor: CategoryActor, id: number, direction: 'up' | 'down'): void {
  loadEditable(db, actor, id)
  const all = ordered(db)
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

/** Deletes an empty category; one holding templates (of any facility) is 409 template_category_not_empty. */
export function deleteCategory(db: Db, actor: CategoryActor, id: number): void {
  loadEditable(db, actor, id)
  const used = db.select({ id: printTemplates.id }).from(printTemplates).where(eq(printTemplates.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'template_category_not_empty')
  db.delete(templateCategories).where(eq(templateCategories.id, id)).run()
}
