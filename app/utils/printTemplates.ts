import { nowInBerlin } from '#shared/domain/timeRecords'
import type { TemplateVisibility } from '#shared/domain/templateCategories'
import type { IsoDate } from '#shared/domain/types'
import type { PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'

/** The Berlin day of a stored timestamp (upload, change). */
export const berlinDay = (timestamp: string): IsoDate => nowInBerlin(new Date(timestamp)).date

/** Where a template's PDF is served (shown in the browser, which prints it). */
export const templateFileUrl = (id: number): string => `/api/print-templates/${id}/file`

/** The key of the sub-tab „Vom Träger“: templates for all facilities without a category of their name in the facility. */
export const FROM_PROVIDER_TAB = 'provider'

/** A sub-tab of „Dokumente“ → „Vorlagen“: a category of the facility, or „Vom Träger“ (`category` null). */
export interface TemplateTab {
  key: string
  category: TemplateCategoryDto | null
  templates: PrintTemplateDto[]
}

const byTitle = (a: PrintTemplateDto, b: PrintTemplateDto) => a.title.localeCompare(b.title, 'de') || a.id - b.id

/**
 * The sub-tabs: every category the viewer sees (the server lists only those), in the facility's order, also an empty one;
 * then „Vom Träger“ when there are templates for all facilities that fit no category of the facility. Titles alphabetical
 * („Vom Träger“ by the category name the Träger chose first).
 */
export function templateTabs(categories: TemplateCategoryDto[], templates: PrintTemplateDto[]): TemplateTab[] {
  const tabs: TemplateTab[] = categories.map(category => ({
    key: `category-${category.id}`,
    category,
    templates: templates.filter(template => template.categoryId === category.id).sort(byTitle),
  }))
  const fromProvider = templates.filter(template => template.categoryId === null)
    .sort((a, b) => a.category.localeCompare(b.category, 'de') || byTitle(a, b))
  if (fromProvider.length > 0) tabs.push({ key: FROM_PROVIDER_TAB, category: null, templates: fromProvider })
  return tabs
}

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

/**
 * How many templates of the category Leitung, Mitarbeiter and the tablet would no longer see with the new visibility:
 * all of them when it becomes the Träger's alone, else none (to ask before saving).
 */
export function hiddenByVisibility(category: TemplateCategoryDto, visibility: TemplateVisibility): number {
  return visibility === 'provider' && category.visibility !== 'provider' ? category.templateCount : 0
}

/** The title a chosen file suggests: its name without the extension. */
export const titleFromFileName = (name: string): string => name.replace(/\.[^.]*$/, '').trim()
