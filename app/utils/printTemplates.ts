import { nowInBerlin } from '#shared/domain/timeRecords'
import { categoryPath, type TemplateVisibility } from '#shared/domain/templateCategories'
import type { IsoDate } from '#shared/domain/types'
import type { PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'
import { subcategoriesOf, topCategories } from './subcategories'

/** The Berlin day of a stored timestamp (upload, change). */
export const berlinDay = (timestamp: string): IsoDate => nowInBerlin(new Date(timestamp)).date

/** Where a template's PDF is served (shown in the browser, which prints it). */
export const templateFileUrl = (id: number): string => `/api/print-templates/${id}/file`

/** The key of the sub-tab „Vom Träger“: templates for all facilities without a category of their name in the facility. */
export const FROM_PROVIDER_TAB = 'provider'

/**
 * A sub-tab of „Dokumente“ → „Vorlagen“: a category of the facility (with its subcategories), or „Vom Träger“
 * (`category` null).
 */
export interface TemplateTab {
  key: string
  category: TemplateCategoryDto | null
  subcategories: TemplateCategoryDto[]
  /** All templates of the category, its subcategories' as well. */
  templates: PrintTemplateDto[]
}

/**
 * The sub-tabs: every category the viewer sees (the server lists only those; subcategories go with their category), in
 * the facility's order, also an empty one; then „Vom Träger“ when there are templates for all facilities that fit no
 * category of the facility. The templates in the order the server lists them (the facility's ▲/▼ order).
 */
export function templateTabs(categories: TemplateCategoryDto[], templates: PrintTemplateDto[]): TemplateTab[] {
  const tabs: TemplateTab[] = topCategories(categories).map(category => ({
    key: `category-${category.id}`,
    category,
    subcategories: subcategoriesOf(categories, category.id),
    templates: templates.filter(template => template.categoryId === category.id),
  }))
  const fromProvider = templates.filter(template => template.categoryId === null)
  if (fromProvider.length > 0) tabs.push({ key: FROM_PROVIDER_TAB, category: null, subcategories: [], templates: fromProvider })
  return tabs
}

/** The template's place to show under „Vom Träger“: the category name the Träger chose, with the subcategory name. */
export const templatePath = (template: Pick<PrintTemplateDto, 'category' | 'subcategory'>): string =>
  categoryPath(template.category, template.subcategory)

/** The sub-tab to open: the one asked for (or remembered) when it is there, else the first. */
export function chosenTemplateTab(tabs: readonly TemplateTab[], wanted: string | null): string | null {
  return tabs.find(tab => tab.key === wanted)?.key ?? tabs[0]?.key ?? null
}

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
 * longer see with the new visibility: all of them (the facility's own and the Träger's shown in it by name) when it
 * becomes the Träger's alone, else none (to ask before saving). `global`: how many of them are the Träger's.
 */
export function hiddenByVisibility(
  category: TemplateCategoryDto, visibility: TemplateVisibility, categories: readonly TemplateCategoryDto[] = [],
): { count: number; global: number } {
  if (visibility !== 'provider' || category.visibility === 'provider') return { count: 0, global: 0 }
  const covered = withSubcategories(category, categories)
  const global = covered.reduce((sum, row) => sum + row.globalCount, 0)
  return { count: covered.reduce((sum, row) => sum + row.templateCount, 0) + global, global }
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
 * Who sees a new template for all facilities, to start with: the visibility of the category it is filed under (the open
 * sub-tab's, or the facility's category of the typed name), so a template for a restricted category stays restricted
 * where a facility has no category of that name; 'all' without one. Clamped to what the editor may give.
 */
export function defaultGlobalVisibility(category: TemplateCategoryDto | null | undefined, levels: readonly TemplateVisibility[]): TemplateVisibility {
  if (!category) return 'all'
  return levels.includes(category.visibility) ? category.visibility : levels.at(-1) ?? 'all'
}

/** The title a chosen file suggests: its name without the extension. */
export const titleFromFileName = (name: string): string => name.replace(/\.[^.]*$/, '').trim()
