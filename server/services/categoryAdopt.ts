import { asc, eq } from 'drizzle-orm'
import { comparableContactName } from '../../shared/domain/contacts'
import { spansFacilities, type DocumentScope } from '../../shared/domain/documentTargets'
import { can, type PermissionKey } from '../../shared/domain/permissions'
import { categoriesInTreeOrder, categoryPlacer, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { MissingCategoriesDto, MissingCategoriesInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { contactCategories, facilities, knowledgeCategories, templateCategories } from '../db/schema'
import { ServiceError } from '../lib/errors'

/**
 * An item of the Träger for several or all facilities is filed by category name (Vorlagen and „Wissen“ also by a
 * subcategory name); a facility without a category of that name shows it under „Vom Träger“. Before saving, the dialog
 * asks whether the category should be created in the facilities that lack it (`missingCategories`); saving with
 * `createCategories` creates it there (`createMissingCategories`, in the save's transaction). Names match as they do for
 * the placing: regardless of case, ß/ss alike (shared/domain/templateCategories.ts `foldCategoryName`,
 * shared/domain/contacts.ts `comparableContactName`), so a name that differs only by case counts as there.
 */
export type AdoptKind = 'template' | 'knowledge' | 'contact'

/** The right that files items for several facilities, by kind. */
const GLOBAL_RIGHT: Record<AdoptKind, PermissionKey> = {
  template: 'printTemplates.global', knowledge: 'knowledge.global', contact: 'contacts.global',
}

/** A category row as far as matching and creating go (contact categories have neither subcategories nor a visibility). */
interface CategoryNode { id: number; parentId: number | null; name: string; sortOrder: number; visibility: TemplateVisibility }

/** The facility's categories of the kind, each category followed by its subcategories, in their order (ties by id). */
function categoriesOf(db: Db, kind: AdoptKind, facilityId: number): CategoryNode[] {
  if (kind === 'contact') {
    return db.select().from(contactCategories).where(eq(contactCategories.facilityId, facilityId))
      .orderBy(asc(contactCategories.sortOrder), asc(contactCategories.id)).all()
      .map(row => ({ ...row, parentId: null, visibility: 'all' as const }))
  }
  const table = kind === 'template' ? templateCategories : knowledgeCategories
  return categoriesInTreeOrder(db.select().from(table).where(eq(table.facilityId, facilityId))
    .orderBy(asc(table.sortOrder), asc(table.id)).all())
}

/** Where an item filed by these names lands in the facility: the matching category and subcategory (null = missing). */
function spotIn(kind: AdoptKind, rows: readonly CategoryNode[], categoryName: string, subcategoryName: string | null) {
  if (kind === 'contact') {
    const key = comparableContactName(categoryName)
    return { category: rows.find(row => comparableContactName(row.name) === key) ?? null, subcategory: null }
  }
  return categoryPlacer(rows).byName(categoryName, subcategoryName)
}

/** The subcategory name as filed: none for contacts or when blank. */
const subName = (kind: AdoptKind, name: string | null | undefined) => (kind === 'contact' || !name?.trim() ? null : name.trim())

/** Whether the facility lacks the category, or (with a subcategory name) the subcategory under it. */
function lacks(kind: AdoptKind, rows: readonly CategoryNode[], categoryName: string, subcategoryName: string | null): boolean {
  const spot = spotIn(kind, rows, categoryName, subcategoryName)
  return !spot.category || (subcategoryName !== null && !spot.subcategory)
}

/**
 * The facilities of the scope the dialog asks about: every facility for 'all', the chosen existing ones for
 * 'selected'; none for the own facility or a single chosen one (`spansFacilities`).
 */
function facilitiesOfScope(db: Db, scope: DocumentScope, facilityIds: readonly number[]): { id: number; name: string }[] {
  if (!spansFacilities(scope, facilityIds)) return []
  const all = db.select({ id: facilities.id, name: facilities.name }).from(facilities).orderBy(asc(facilities.id)).all()
  return scope === 'all' ? all : all.filter(row => facilityIds.includes(row.id))
}

/**
 * The facilities of the item's „Gilt für“ (several or all; future facilities are not asked about) that lack its category
 * name or, given one, its subcategory name there. For the Träger only (the kind's global right, else 403).
 */
export function missingCategories(
  db: Db, kind: AdoptKind, actor: { permissions: ReadonlySet<PermissionKey> }, input: MissingCategoriesInput,
): MissingCategoriesDto {
  if (!can(actor.permissions, GLOBAL_RIGHT[kind])) throw new ServiceError(403, 'forbidden')
  const categoryName = input.categoryName.trim()
  if (categoryName === '') return { facilities: [] }
  const subcategoryName = subName(kind, input.subcategoryName)
  return {
    facilities: facilitiesOfScope(db, input.scope, input.facilityIds ?? [])
      .filter(facility => lacks(kind, categoriesOf(db, kind, facility.id), categoryName, subcategoryName)),
  }
}

/** 403 unless the actor may have categories created with the save (the kind's global right). */
export function assertMayCreateCategories(kind: AdoptKind, actor: { permissions: ReadonlySet<PermissionKey> }): void {
  if (!can(actor.permissions, GLOBAL_RIGHT[kind])) throw new ServiceError(403, 'forbidden')
}

/**
 * Creates the item's category – and its subcategory under it – in each of the facilities (those of the item's „Gilt
 * für“) that lacks them, at the end of the facility's categories (of the category's subcategories). Who sees a new one
 * (Vorlagen, „Wissen“): as the category (subcategory) of that name in the acting facility, else everyone. A name there
 * that differs only by case counts as existing (no duplicate). Call it inside the save's transaction, before the item is
 * placed (so it lands there, at the end).
 */
export function createMissingCategories(
  db: Db, kind: AdoptKind, actingFacilityId: number, facilityIds: readonly number[], categoryName: string,
  subcategoryNameInput: string | null | undefined,
): void {
  const name = categoryName.trim()
  if (name === '') return
  const subcategoryName = subName(kind, subcategoryNameInput)
  const source = spotIn(kind, categoriesOf(db, kind, actingFacilityId), name, subcategoryName)
  const visibility = source.category?.visibility ?? 'all'
  const subVisibility = source.subcategory?.visibility ?? 'all'
  for (const facilityId of new Set(facilityIds)) {
    const rows = categoriesOf(db, kind, facilityId)
    if (!lacks(kind, rows, name, subcategoryName)) continue
    const endOf = (parentId: number | null) => rows.filter(row => row.parentId === parentId).reduce((max, row) => Math.max(max, row.sortOrder + 1), 0)
    const parentId = spotIn(kind, rows, name, subcategoryName).category?.id
      ?? insertCategory(db, kind, { facilityId, parentId: null, name, sortOrder: endOf(null), visibility })
    if (subcategoryName === null) continue
    insertCategory(db, kind, { facilityId, parentId, name: subcategoryName, sortOrder: endOf(parentId), visibility: subVisibility })
  }
}

/** Inserts one category row of the kind; returns its id. */
function insertCategory(
  db: Db, kind: AdoptKind, row: { facilityId: number; parentId: number | null; name: string; sortOrder: number; visibility: TemplateVisibility },
): number {
  if (kind === 'contact') {
    return db.insert(contactCategories).values({ facilityId: row.facilityId, name: row.name, sortOrder: row.sortOrder })
      .returning({ id: contactCategories.id }).get().id
  }
  if (kind === 'template') return db.insert(templateCategories).values(row).returning({ id: templateCategories.id }).get().id
  return db.insert(knowledgeCategories).values(row).returning({ id: knowledgeCategories.id }).get().id
}
