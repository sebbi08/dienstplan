import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import {
  EXAMPLE_FORM_CATEGORIES, FORM_CATEGORY_NAME_MAX, FORM_CATEGORY_SEED_KEY, foldFormCategoryName, formCategoriesInTreeOrder,
} from '../../shared/domain/formCategories'
import type { FormKind } from '../../shared/domain/forms'
import type { FormTemplateCategoryDto, FormTemplateCategoryInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { formStarterSeeds, formTemplateCategories, formTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * The categories of the form templates (Dokumente → Bögen), one list per facility with one level of subcategories: a
 * subcategory belongs to a category of the same facility, never to another subcategory. formTemplates.manage maintains
 * those of the facility it works in (the routes check the key); another facility's category is 404.
 */

export type FormCategoryRow = typeof formTemplateCategories.$inferSelect

/** The facility's categories, each category followed by its subcategories, in their order. */
export const facilityFormCategories = (db: Db, facilityId: number): FormCategoryRow[] =>
  formCategoriesInTreeOrder(db.select().from(formTemplateCategories).where(eq(formTemplateCategories.facilityId, facilityId))
    .orderBy(asc(formTemplateCategories.sortOrder), asc(formTemplateCategories.id)).all())

/** The facility's categories in their order, with how many templates are filed directly in each. */
export function listFormCategories(db: Db, facilityId: number): FormTemplateCategoryDto[] {
  const rows = facilityFormCategories(db, facilityId)
  const counts = new Map(rows.length === 0 ? [] : db.select({ id: formTemplates.categoryId, n: count() }).from(formTemplates)
    .where(inArray(formTemplates.categoryId, rows.map(row => row.id))).groupBy(formTemplates.categoryId).all()
    .map(row => [row.id, row.n]))
  return rows.map(row => ({ id: row.id, parentId: row.parentId, name: row.name, templateCount: counts.get(row.id) ?? 0 }))
}

/** A category or subcategory of the facility to file a template in (null = none); another one is 400 form_category_invalid. */
export function chosenFormCategory(db: Db, facilityId: number, id: number | null): number | null {
  if (id === null) return null
  const row = db.select({ id: formTemplateCategories.id }).from(formTemplateCategories)
    .where(and(eq(formTemplateCategories.id, id), eq(formTemplateCategories.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(400, 'form_category_invalid')
  return row.id
}

/** The facility's category (404 form_category_not_found otherwise, also for another facility's). */
function loadCategory(db: Db, facilityId: number, id: number): { row: FormCategoryRow; all: FormCategoryRow[] } {
  const all = facilityFormCategories(db, facilityId)
  const row = all.find(category => category.id === id)
  if (!row) throw new ServiceError(404, 'form_category_not_found')
  return { row, all }
}

/** The trimmed name (1–60), unique among its siblings regardless of case (409 form_category_name_taken). */
function checkedName(all: readonly FormCategoryRow[], name: string, parentId: number | null, current: FormCategoryRow | null): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ServiceError(400, 'form_category_name_required')
  if (trimmed.length > FORM_CATEGORY_NAME_MAX) throw new ServiceError(400, 'form_category_name_too_long')
  const clash = all.some(row => row.id !== current?.id && row.parentId === parentId && foldFormCategoryName(row.name) === foldFormCategoryName(trimmed))
  if (clash) throw new ServiceError(409, 'form_category_name_taken')
  return trimmed
}

/**
 * Runs a write that may hit the unique index on (facility, parent, lower(name)): when two requests pass the name check at
 * the same time, the second one's clash is 409 form_category_name_taken as well (not a 500).
 */
function uniqueName<T>(write: () => T): T {
  try {
    return write()
  }
  catch (error) {
    if (String((error as Error).message).includes('UNIQUE')) throw new ServiceError(409, 'form_category_name_taken')
    throw error
  }
}

/**
 * A new category at the end of the facility's list, or with `parentId` a new subcategory at the end of that category's
 * (a category of the facility, not itself a subcategory: else 400 form_category_parent_invalid); returns its id.
 */
export function createFormCategory(db: Db, facilityId: number, input: FormTemplateCategoryInput): number {
  const all = facilityFormCategories(db, facilityId)
  const parentId = input.parentId ?? null
  if (parentId !== null) {
    const parent = all.find(row => row.id === parentId)
    if (!parent || parent.parentId !== null) throw new ServiceError(400, 'form_category_parent_invalid')
  }
  const name = checkedName(all, input.name, parentId, null)
  const last = all.filter(row => row.parentId === parentId).at(-1)
  return uniqueName(() => db.insert(formTemplateCategories).values({ facilityId, parentId, name, sortOrder: last ? last.sortOrder + 1 : 0 })
    .returning({ id: formTemplateCategories.id }).get().id)
}

/** Renames the category; where it sits (category or subcategory) stays. */
export function renameFormCategory(db: Db, facilityId: number, id: number, input: Pick<FormTemplateCategoryInput, 'name'>): void {
  const { row, all } = loadCategory(db, facilityId, id)
  const name = checkedName(all, input.name, row.parentId, row)
  uniqueName(() => db.update(formTemplateCategories).set({ name }).where(eq(formTemplateCategories.id, id)).run())
}

/** Swaps the category with its neighbour among its siblings; at an end nothing changes. The siblings are numbered afresh. */
export function moveFormCategory(db: Db, facilityId: number, id: number, direction: 'up' | 'down'): void {
  const { row, all } = loadCategory(db, facilityId, id)
  const siblings = all.filter(other => other.parentId === row.parentId)
  const at = siblings.findIndex(other => other.id === id)
  const to = direction === 'up' ? at - 1 : at + 1
  if (to < 0 || to >= siblings.length) return
  const swapped = [...siblings]
  ;[swapped[at], swapped[to]] = [swapped[to]!, swapped[at]!]
  db.transaction((tx) => {
    swapped.forEach((sibling, index) => {
      if (sibling.sortOrder !== index) tx.update(formTemplateCategories).set({ sortOrder: index }).where(eq(formTemplateCategories.id, sibling.id)).run()
    })
  })
}

/**
 * Deletes an empty category: one with subcategories is 409 form_category_has_subcategories, one holding templates (also
 * stopped ones) 409 form_category_not_empty.
 */
export function deleteFormCategory(db: Db, facilityId: number, id: number): void {
  const { all } = loadCategory(db, facilityId, id)
  if (all.some(row => row.parentId === id)) throw new ServiceError(409, 'form_category_has_subcategories')
  const used = db.select({ id: formTemplates.id }).from(formTemplates).where(eq(formTemplates.categoryId, id)).limit(1).get()
  if (used) throw new ServiceError(409, 'form_category_not_empty')
  db.delete(formTemplateCategories).where(eq(formTemplateCategories.id, id)).run()
}

/**
 * Gives the facility the example categories once (EXAMPLE_FORM_CATEGORIES, recorded in form_starter_seeds, so a deleted
 * one is not created again); a name it already uses is kept. Call it inside the caller's transaction.
 */
export function seedFormCategories(db: Db, facilityId: number, now: Date = new Date()): void {
  const seeded = db.select({ key: formStarterSeeds.starterKey }).from(formStarterSeeds)
    .where(and(eq(formStarterSeeds.facilityId, facilityId), eq(formStarterSeeds.starterKey, FORM_CATEGORY_SEED_KEY))).get()
  if (seeded) return
  for (const example of EXAMPLE_FORM_CATEGORIES) {
    const all = facilityFormCategories(db, facilityId)
    if (all.some(row => row.parentId === null && foldFormCategoryName(row.name) === foldFormCategoryName(example.name))) continue
    createFormCategory(db, facilityId, { name: example.name, parentId: null })
  }
  db.insert(formStarterSeeds).values({ facilityId, starterKey: FORM_CATEGORY_SEED_KEY, seededAt: now.toISOString() }).run()
}

/** The facility's top category named like the example of the kind (a starter template is filed there), else null. */
export function exampleCategoryOf(db: Db, facilityId: number, kind: FormKind): number | null {
  const example = EXAMPLE_FORM_CATEGORIES.find(entry => entry.kind === kind)
  if (!example) return null
  return db.select({ id: formTemplateCategories.id, name: formTemplateCategories.name }).from(formTemplateCategories)
    .where(and(eq(formTemplateCategories.facilityId, facilityId), isNull(formTemplateCategories.parentId))).all()
    .find(row => foldFormCategoryName(row.name) === foldFormCategoryName(example.name))?.id ?? null
}
