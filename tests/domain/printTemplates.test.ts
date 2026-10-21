import { describe, expect, it } from 'vitest'
import { berlinDay, categorySuggestions, groupByCategory, titleFromFileName } from '../../app/utils/printTemplates'
import type { PrintTemplateDto } from '../../shared/types/api'

const template = (id: number, category: string, title: string): PrintTemplateDto => ({
  id, title, category, global: false, size: 1, uploadedAt: '', updatedAt: '', canEdit: true,
})

describe('print template page helpers', () => {
  it('groups by category, both alphabetical', () => {
    const groups = groupByCategory([
      template(1, 'Sonstiges', 'Zettel'), template(2, 'Eltern', 'Übernachtung'), template(3, 'Eltern', 'Ausflug'),
      template(4, 'Ärztliches', 'Attest'),
    ])
    expect(groups.map(group => [group.category, group.templates.map(t => t.title)])).toEqual([
      ['Ärztliches', ['Attest']], ['Eltern', ['Ausflug', 'Übernachtung']], ['Sonstiges', ['Zettel']],
    ])
  })

  it('suggests the default categories and those in use, each once', () => {
    expect(categorySuggestions([template(1, 'Küche', 'Plan'), template(2, 'Eltern', 'Brief')]))
      .toEqual(['Eltern', 'Gesundheit', 'Küche', 'Personal'])
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
