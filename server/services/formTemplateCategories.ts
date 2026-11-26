import { and, eq } from 'drizzle-orm'
import { bogenCategoryName, EXAMPLE_FORM_CATEGORIES, FORM_CATEGORY_SEED_KEY, foldFormCategoryName } from '../../shared/domain/formCategories'
import type { FormKind } from '../../shared/domain/forms'
import { seesCategoryNode, stricterVisibility, TEMPLATE_VISIBILITIES, type TemplateVisibility } from '../../shared/domain/templateCategories'
import type { Role } from '../../shared/types/api'
import type { Db } from '../db/client'
import { formStarterSeeds, templateCategories } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { facilityCategories } from './templateCategories'

/**
 * The Bögen (form templates) in the facility's categories of „Dokumente“ → „Vorlagen“, which they share with the PDF
 * templates since 0133_one_template_library (template_categories, maintained in server/services/templateCategories.ts).
 * „Wer sieht sie?“ of a category (and of its subcategory, the stricter wins) applies to the Bögen in it as well: in the
 * library, the pickers of new forms and when a form is made from one. A Bogen without a category is seen by everyone
 * who sees Bögen at all.
 */

type CategoryRow = ReturnType<typeof facilityCategories>[number]

/** Whether someone of the role sees a Bogen filed in the category row `categoryId` (null: none) of the facility's `categories`. */
export function seesFormCategory(categories: readonly CategoryRow[], categoryId: number | null, role: Role): boolean {
  if (categoryId === null) return true
  const row = categories.find(category => category.id === categoryId)
  return !!row && seesCategoryNode(role, row, categories)
}

/** Who sees a Bogen filed in the category row `categoryId` (null: none, everyone): the category's and its parent's „Wer sieht sie?“. */
export function formCategoryVisibility(categories: readonly CategoryRow[], categoryId: number | null): TemplateVisibility {
  const row = categoryId === null ? undefined : categories.find(category => category.id === categoryId)
  if (!row) return 'all'
  const parent = row.parentId === null ? undefined : categories.find(category => category.id === row.parentId)
  return stricterVisibility(row.visibility, parent?.visibility ?? 'all')
}

/**
 * Whether filing a Bogen in `to` instead of `from` (null: none; a new Bogen: from none) hides it from some who saw it –
 * a category not everyone sees (Mitarbeitende, Gruppenleitungen and the tablet, for „nur Träger“ the Leitung as well). The
 * editor confirms that first (`confirmRestricted`, else 409 form_category_restricted), so a Bogen does not silently
 * vanish from the pickers of those who fill it in.
 */
export function assertFilingConfirmed(db: Db, facilityId: number, from: number | null, to: number | null, confirmed: boolean | undefined): void {
  if (confirmed || to === null || to === from) return
  const categories = facilityCategories(db, facilityId)
  const order = (visibility: TemplateVisibility) => TEMPLATE_VISIBILITIES.indexOf(visibility)
  if (order(formCategoryVisibility(categories, to)) > order(formCategoryVisibility(categories, from))) {
    throw new ServiceError(409, 'form_category_restricted')
  }
}

/**
 * A category or subcategory of the facility that the role sees, to file a Bogen in (null = none); another one is 400
 * form_category_invalid.
 */
export function chosenFormCategory(db: Db, facilityId: number, role: Role, id: number | null): number | null {
  if (id === null) return null
  if (!seesFormCategory(facilityCategories(db, facilityId), id, role)) throw new ServiceError(400, 'form_category_invalid')
  return id
}

/** The facility's top categories everyone sees (where an example category of the Bögen may be). */
const openTops = (db: Db, facilityId: number) => facilityCategories(db, facilityId).filter(row => row.parentId === null)

/**
 * Gives the facility the example categories of the Bögen once (EXAMPLE_FORM_CATEGORIES, recorded in form_starter_seeds,
 * so a deleted one is not created again), at the end of its categories, visible to all. A name it already uses for a
 * category everyone sees is kept; a name it uses for a stricter one gets a category „‹Name› (Bögen)“ instead (as
 * 0133_one_template_library did), so the starters filed there stay offered to everyone who fills them in. Call it inside
 * the caller's transaction.
 */
export function seedFormCategories(db: Db, facilityId: number, now: Date = new Date()): void {
  const seeded = db.select({ key: formStarterSeeds.starterKey }).from(formStarterSeeds)
    .where(and(eq(formStarterSeeds.facilityId, facilityId), eq(formStarterSeeds.starterKey, FORM_CATEGORY_SEED_KEY))).get()
  if (seeded) return
  for (const example of EXAMPLE_FORM_CATEGORIES) {
    const tops = openTops(db, facilityId)
    const named = (name: string) => tops.find(row => foldFormCategoryName(row.name) === foldFormCategoryName(name))
    const same = named(example.name)
    if (same?.visibility === 'all' || named(bogenCategoryName(example.name))) continue
    const sortOrder = tops.reduce((last, row) => Math.max(last, row.sortOrder + 1), 0)
    db.insert(templateCategories).values({
      facilityId, parentId: null, name: same ? bogenCategoryName(example.name) : example.name, sortOrder, visibility: 'all',
    }).run()
  }
  db.insert(formStarterSeeds).values({ facilityId, starterKey: FORM_CATEGORY_SEED_KEY, seededAt: now.toISOString() }).run()
}

/**
 * The facility's top category for the starter templates of the kind: named like the example of the kind (else like
 * „‹Name› (Bögen)“) and seen by everyone – a starter must reach whoever fills it in –; null when there is none.
 */
export function exampleCategoryOf(db: Db, facilityId: number, kind: FormKind): number | null {
  const example = EXAMPLE_FORM_CATEGORIES.find(entry => entry.kind === kind)
  if (!example) return null
  const tops = openTops(db, facilityId).filter(row => row.visibility === 'all')
  const named = (name: string) => tops.find(row => foldFormCategoryName(row.name) === foldFormCategoryName(name))?.id
  return named(example.name) ?? named(bogenCategoryName(example.name)) ?? null
}
