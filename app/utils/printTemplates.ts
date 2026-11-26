import { nowInBerlin } from '#shared/domain/timeRecords'
import { categoryPath, stricterVisibility, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { IsoDate } from '#shared/domain/types'
import type { PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'
import { subcategoriesOf, topCategories } from './subcategories'

/** The Berlin day of a stored timestamp (upload, change). */
export const berlinDay = (timestamp: string): IsoDate => nowInBerlin(new Date(timestamp)).date

/** Where a template's PDF is served (shown in the browser, which prints it). */
export const templateFileUrl = (id: number): string => `/api/print-templates/${id}/file`

/*
 * The sub-tabs of „Dokumente“ → „Vorlagen“ (both kinds of entries, the categories, „Vom Träger“, „Ohne Kategorie“) are
 * built in app/utils/templateEntries.ts; here the PDF templates' own helpers.
 */

/** The template's place to show under „Vom Träger“: the category name the Träger chose, with the subcategory name. */
export const templatePath = (template: Pick<PrintTemplateDto, 'category' | 'subcategory'>): string =>
  categoryPath(template.category, template.subcategory)

const TAB_MEMORY_KEY = 'dienstplan.templatesTab'

/** The sub-tab this device opened last; null when storage is unavailable. */
export function readTemplateTabMemory(): string | null {
  try {
    return localStorage.getItem(TAB_MEMORY_KEY)
  }
  catch {
    return null
  }
}

export function writeTemplateTabMemory(key: string): void {
  try {
    localStorage.setItem(TAB_MEMORY_KEY, key)
  }
  catch {
    // Not remembered; switching still works on this page.
  }
}

/** The category and, for a category, its subcategories (whose templates its visibility covers as well). */
const withSubcategories = (category: TemplateCategoryDto, categories: readonly TemplateCategoryDto[]) =>
  [category, ...(category.parentId === null ? subcategoriesOf(categories, category.id) : [])]

/**
 * How many templates of the category (a category's subcategories included) Leitung, Mitarbeiter and the tablet would no
 * longer see with the new visibility: all of them (the facility's own PDF templates and Bögen, and the Träger's PDF
 * templates shown in it by name) when it becomes the Träger's alone, else none (to ask before saving). `global`: how
 * many of them are the Träger's.
 */
export function hiddenByVisibility(
  category: TemplateCategoryDto, visibility: TemplateVisibility, categories: readonly TemplateCategoryDto[] = [],
): { count: number; global: number } {
  if (visibility !== 'provider' || category.visibility === 'provider') return { count: 0, global: 0 }
  const covered = withSubcategories(category, categories)
  const global = covered.reduce((sum, row) => sum + row.globalCount, 0)
  return { count: covered.reduce((sum, row) => sum + row.templateCount + row.formCount, 0) + global, global }
}

/** Whether two category names count as the same (case, umlauts and ß/ss aside), as the server compares them. */
export const sameCategoryName = (a: string, b: string): boolean => {
  const fold = (name: string) => name.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')
  return fold(a) === fold(b)
}

/**
 * How many of the Träger's templates for all facilities leave the category when it is deleted (`newName` null) or
 * renamed to `newName` (to name them in the confirmation): from a category (with those of its subcategories) to „Vom
 * Träger“, from a subcategory directly into its category.
 */
export function movedToProvider(category: TemplateCategoryDto, newName: string | null, categories: readonly TemplateCategoryDto[] = []): number {
  if (newName !== null && sameCategoryName(category.name, newName)) return 0
  return withSubcategories(category, categories).reduce((sum, row) => sum + row.globalCount, 0)
}

/**
 * Who sees a new template for all facilities, to start with: the visibility that applies where it is filed (the open
 * sub-tab's category and small tab's subcategory, or the facility's category and subcategory of the typed names; the
 * stricter of both), so a template for a restricted place stays restricted where a facility has no category of that
 * name; 'all' without one. Clamped to what the editor may give.
 */
export function defaultGlobalVisibility(
  category: TemplateCategoryDto | null | undefined, levels: readonly TemplateVisibility[], subcategory?: TemplateCategoryDto | null,
): TemplateVisibility {
  if (!category) return 'all'
  const visibility = stricterVisibility(category.visibility, subcategory?.visibility ?? 'all')
  return levels.includes(visibility) ? visibility : levels.at(-1) ?? 'all'
}

/**
 * The facility's category of the typed name (regardless of case) and its subcategory of the typed subcategory name,
 * where a template for all facilities filed so shows here.
 */
export function categoryOfNames(
  categories: readonly TemplateCategoryDto[], categoryName: string, subcategoryName: string,
): { category: TemplateCategoryDto | undefined; subcategory: TemplateCategoryDto | undefined } {
  const category = topCategories(categories).find(row => sameCategoryName(row.name, categoryName))
  const subcategory = category && subcategoryName.trim() !== ''
    ? subcategoriesOf(categories, category.id).find(row => sameCategoryName(row.name, subcategoryName))
    : undefined
  return { category, subcategory }
}

/** The title a chosen file suggests: its name without the extension. */
export const titleFromFileName = (name: string): string => name.replace(/\.[^.]*$/, '').trim()
