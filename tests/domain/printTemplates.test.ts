import { describe, expect, it } from 'vitest'
import { berlinDay, groupByCategory, titleFromFileName } from '../../app/utils/printTemplates'
import type { PrintTemplateDto, TemplateCategoryDto } from '../../shared/types/api'

const template = (id: number, categoryId: number, title: string): PrintTemplateDto => ({
  id, title, categoryId, category: '', global: false, size: 1, uploadedAt: '', updatedAt: '', canEdit: true,
})
const category = (id: number, name: string): TemplateCategoryDto => ({ id, name, visibility: 'all', inUse: true })

describe('print template page helpers', () => {
  it('groups by category in the categories\' order, titles alphabetical, and leaves out empty categories', () => {
    const groups = groupByCategory([category(3, 'Sonstiges'), category(1, 'Eltern'), category(2, 'Leer')], [
      template(1, 3, 'Zettel'), template(2, 1, 'Übernachtung'), template(3, 1, 'Ausflug'), template(4, 3, 'Attest'),
      // A category the viewer does not see (not in the list) shows nothing.
      template(5, 9, 'Versteckt'),
    ])
    expect(groups.map(group => [group.category.name, group.templates.map(t => t.title)])).toEqual([
      ['Sonstiges', ['Attest', 'Zettel']], ['Eltern', ['Ausflug', 'Übernachtung']],
    ])
  })

  it('shows the Berlin day of a timestamp', () => {
    expect(berlinDay('2026-10-20T22:30:00.000Z')).toBe('2026-10-21')
    expect(berlinDay('2026-12-31T12:00:00.000Z')).toBe('2026-12-31')
  })

  it('takes the file name without extension as title', () => {
    expect(titleFromFileName('Einverständnis Ausflug.pdf')).toBe('Einverständnis Ausflug')
    expect(titleFromFileName('Brief.v2.PDF')).toBe('Brief.v2')
    expect(titleFromFileName('ohne')).toBe('ohne')
  })
})
