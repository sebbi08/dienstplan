import { describe, expect, it } from 'vitest'
import type { FormContent, FormSection } from '../../shared/domain/forms'
import { filledAnswers, isBlank, sectionBlocks, sectionHasRating } from '../../app/utils/forms'

const section: FormSection = {
  id: 's1', title: 'Motorik', hint: '',
  items: [
    { id: 'n1', kind: 'note', text: 'Hinweis' },
    { id: 'r1', kind: 'rating', criterion: 'A' },
    { id: 'r2', kind: 'rating', criterion: 'B' },
    { id: 'm1', kind: 'milestone', text: 'läuft', ageLabel: '3;0' },
    { id: 't1', kind: 'text', question: 'Frage' },
    { id: 'm2', kind: 'milestone', text: 'hüpft', ageLabel: '4;0' },
    { id: 'm3', kind: 'milestone', text: 'rennt', ageLabel: '3;0' },
    { id: 'r3', kind: 'rating', criterion: 'C' },
  ],
}

describe('sectionBlocks', () => {
  it('groups consecutive ratings and all milestones by age at the first milestone', () => {
    const blocks = sectionBlocks(section)
    expect(blocks.map(block => block.type)).toEqual(['item', 'ratings', 'milestones', 'item', 'ratings'])
    const milestones = blocks[2]
    expect(milestones?.type === 'milestones' && milestones.groups.map(group => [group.ageLabel, group.items.map(item => item.id)]))
      .toEqual([['3;0', ['m1', 'm3']], ['4;0', ['m2']]])
  })

  it('knows sections with ratings', () => {
    expect(sectionHasRating(section)).toBe(true)
    expect(sectionHasRating({ ...section, items: [section.items[0]!] })).toBe(false)
  })
})

describe('filledAnswers', () => {
  it('fills untouched items with their empty answer and copies stored ones', () => {
    const content: FormContent = { sections: [section] }
    const stored = { r1: { value: '+', remark: 'gut' } }
    const answers = filledAnswers(content, stored)
    expect(Object.keys(answers).sort()).toEqual(['m1', 'm2', 'm3', 'r1', 'r2', 'r3', 't1'])
    expect(answers.r1).toEqual({ value: '+', remark: 'gut' })
    expect(answers.r1).not.toBe(stored.r1)
    expect(answers.t1).toBe('')
    expect(answers.m1).toEqual({ reached: false, remark: '' })
  })

  it('treats empty or whitespace text as blank', () => {
    expect(isBlank('  ')).toBe(true)
    expect(isBlank('x')).toBe(false)
  })
})
