import { nowInBerlin } from '#shared/domain/timeRecords'
import type { IsoDate } from '#shared/domain/types'
import type { PrintTemplateDto } from '#shared/types/api'

/** The Berlin day of a stored timestamp (upload, change). */
export const berlinDay = (timestamp: string): IsoDate => nowInBerlin(new Date(timestamp)).date

/** Categories offered in the form even before a template uses them. */
export const DEFAULT_TEMPLATE_CATEGORIES = ['Eltern', 'Gesundheit', 'Personal']

/** Where a template's PDF is served (shown in the browser, which prints it). */
export const templateFileUrl = (id: number): string => `/api/print-templates/${id}/file`

/** The templates per category, categories and titles alphabetical. */
export function groupByCategory(templates: PrintTemplateDto[]): { category: string; templates: PrintTemplateDto[] }[] {
  const groups = new Map<string, PrintTemplateDto[]>()
  for (const template of templates) groups.set(template.category, [...(groups.get(template.category) ?? []), template])
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([category, list]) => ({ category, templates: [...list].sort((a, b) => a.title.localeCompare(b.title, 'de')) }))
}

/** The suggestions of the category field: the defaults and every category in use, alphabetical, each once. */
export function categorySuggestions(templates: PrintTemplateDto[]): string[] {
  return [...new Set([...DEFAULT_TEMPLATE_CATEGORIES, ...templates.map(template => template.category)])]
    .sort((a, b) => a.localeCompare(b, 'de'))
}

/** The title a chosen file suggests: its name without the extension. */
export const titleFromFileName = (name: string): string => name.replace(/\.[^.]*$/, '').trim()
