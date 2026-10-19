import { describe, expect, it } from 'vitest'
import { coverageRuleSections } from '../../app/utils/coverageRuleSections'

const rule = (id: number, groupId: number | null, start: number, end: number | null = null, label = '') =>
  ({ id, groupId, start, end, label })

describe('mandatory duties by facility and group', () => {
  const groups = [
    { id: 7, name: 'Mäuse', color: 'rose' as const },
    { id: 3, name: 'Bären', color: null },
    { id: 9, name: 'Eulen', color: 'teal' as const }, // no rules: no section
  ]

  it('lists the whole facility first, then the groups in their order, each sorted by start, end and label', () => {
    const rules = [
      rule(1, 3, 900),
      rule(2, null, 900),
      rule(3, 7, 420, 600),
      rule(4, null, 420, 990, 'Früh lang'),
      rule(5, 7, 420, null),
      rule(6, null, 420, 990, 'Früh A'),
      rule(7, 3, 450),
    ]
    const sections = coverageRuleSections(rules, groups)
    expect(sections.map(section => [section.key, section.groupId, section.name, section.color, section.rules.map(r => r.id)])).toEqual([
      ['facility', null, null, null, [6, 4, 2]],
      ['group-7', 7, 'Mäuse', 'rose', [5, 3]],
      ['group-3', 3, 'Bären', null, [7, 1]],
    ])
  })

  it('leaves out the facility without own rules and keeps rules of an unknown group in a last section', () => {
    const sections = coverageRuleSections([rule(1, 42, 600), rule(2, 3, 500), rule(3, 42, 480)], groups)
    expect(sections.map(section => [section.key, section.name, section.rules.map(r => r.id)])).toEqual([
      ['group-3', 'Bären', [2]],
      ['unknown', null, [3, 1]],
    ])
  })

  it('gives nothing for no rules', () => {
    expect(coverageRuleSections([], groups)).toEqual([])
  })
})
