import { nowInBerlin } from '#shared/domain/timeRecords'
import type { IsoDate } from '#shared/domain/types'
import type { PrintTemplateDto, TemplateCategoryDto } from '#shared/types/api'

/** The Berlin day of a stored timestamp (upload, change). */
export const berlinDay = (timestamp: string): IsoDate => nowInBerlin(new Date(timestamp)).date

/** Where a template's PDF is served (shown in the browser, which prints it). */
export const templateFileUrl = (id: number): string => `/api/print-templates/${id}/file`

/** The templates per category, the categories in their order (only those holding templates), titles alphabetical. */
export function groupByCategory(
  categories: TemplateCategoryDto[], templates: PrintTemplateDto[],
): { category: TemplateCategoryDto; templates: PrintTemplateDto[] }[] {
  return categories
    .map(category => ({
      category,
      templates: templates.filter(template => template.categoryId === category.id)
        .sort((a, b) => a.title.localeCompare(b.title, 'de')),
    }))
    .filter(group => group.templates.length > 0)
}

/** The title a chosen file suggests: its name without the extension. */
export const titleFromFileName = (name: string): string => name.replace(/\.[^.]*$/, '').trim()
