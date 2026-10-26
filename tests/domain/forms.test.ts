import { describe, expect, it } from 'vitest'
import {
  addItem, addSection, checkAnswers, checkContent, emptyAnswer, FormError, moveItem, moveSection, removeItem,
  removeSection, updateItem, updateSection, type FormContent, type FormItem,
} from '../../shared/domain/forms'

const ids = () => {
  let n = 0
  return () => `id${++n}`
}

const sample = (): FormContent => ({
  sections: [
    {
      id: 's1', title: 'Einstieg', hint: '', items: [
        { id: 'n1', kind: 'note', text: 'Begrüßung' },
        { id: 't1', kind: 'text', question: 'Wie geht es dir?' },
        { id: 'c1', kind: 'choices', question: 'Was passt?', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }] },
      ],
    },
    {
      id: 's2', title: 'Bewertung', hint: 'Bitte ehrlich', items: [
        { id: 'r1', kind: 'rating', criterion: 'Teamarbeit' },
        { id: 'm1', kind: 'milestone', text: 'Läuft frei', ageLabel: '1;6 Jahre' },
        { id: 'd1', kind: 'date', question: 'Nächstes Gespräch' },
        { id: 'c2', kind: 'choices', question: '', options: [{ id: 'o3', label: 'X' }] },
      ],
    },
  ],
})

const code = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    if (error instanceof FormError) return error.code
    throw error
  }
  return undefined
}

const withItem = (item: Record<string, unknown>): unknown => ({
  sections: [{ id: 's', title: 'T', hint: '', items: [item] }],
})

describe('checkContent', () => {
  it('accepts a valid template and fills a missing hint', () => {
    const raw = sample() as unknown as { sections: Record<string, unknown>[] }
    delete raw.sections[0]!.hint
    const content = checkContent(raw)
    expect(content.sections[0]!.hint).toBe('')
    expect(content.sections[1]!.items).toHaveLength(4)
  })

  it('accepts an empty template and empty sections', () => {
    expect(checkContent({ sections: [] })).toEqual({ sections: [] })
    expect(checkContent({ sections: [{ id: 's', title: 'T', hint: '', items: [] }] }).sections).toHaveLength(1)
  })

  it.each([
    ['not an object', null],
    ['no sections', {}],
    ['section without title', { sections: [{ id: 's', title: '', hint: '', items: [] }] }],
    ['section title 121', { sections: [{ id: 's', title: 'x'.repeat(121), hint: '', items: [] }] }],
    ['hint 1001', { sections: [{ id: 's', title: 'T', hint: 'x'.repeat(1001), items: [] }] }],
    ['section without id', { sections: [{ id: '', title: 'T', hint: '', items: [] }] }],
    ['61 sections', { sections: Array.from({ length: 61 }, (_, i) => ({ id: `s${i}`, title: 'T', hint: '', items: [] })) }],
    ['121 items', {
      sections: [{
        id: 's', title: 'T', hint: '',
        items: Array.from({ length: 121 }, (_, i) => ({ id: `i${i}`, kind: 'note', text: 'x' })),
      }],
    }],
  ])('rejects %s', (_, raw) => {
    expect(code(() => checkContent(raw))).toBe('form_content_invalid')
  })

  it('accepts the limits', () => {
    const raw = {
      sections: [
        {
          id: 's', title: 'x'.repeat(120), hint: 'x'.repeat(1000),
          items: Array.from({ length: 120 }, (_, i) => ({ id: `i${i}`, kind: 'note', text: 'x' })),
        },
        ...Array.from({ length: 59 }, (_, i) => ({ id: `s${i}`, title: 'T', hint: '', items: [] })),
      ],
    }
    expect(checkContent(raw).sections).toHaveLength(60)
  })

  const valid: [string, Record<string, unknown>][] = [
    ['note 1', { id: 'i', kind: 'note', text: 'x' }],
    ['note 1000', { id: 'i', kind: 'note', text: 'x'.repeat(1000) }],
    ['text 300', { id: 'i', kind: 'text', question: 'x'.repeat(300) }],
    ['choices without question', { id: 'i', kind: 'choices', question: '', options: [{ id: 'o', label: 'x' }] }],
    ['choices 40 options of 80', {
      id: 'i', kind: 'choices', question: 'x'.repeat(300),
      options: Array.from({ length: 40 }, (_, n) => ({ id: `o${n}`, label: 'x'.repeat(80) })),
    }],
    ['rating 300', { id: 'i', kind: 'rating', criterion: 'x'.repeat(300) }],
    ['milestone at limits', { id: 'i', kind: 'milestone', text: 'x'.repeat(300), ageLabel: 'x'.repeat(20) }],
    ['date 300', { id: 'i', kind: 'date', question: 'x'.repeat(300) }],
  ]
  it.each(valid)('accepts item %s', (_, item) => {
    expect(checkContent(withItem(item)).sections[0]!.items[0]).toEqual(item)
  })

  const invalid: [string, Record<string, unknown>][] = [
    ['unknown kind', { id: 'i', kind: 'slider', text: 'x' }],
    ['item without id', { id: '', kind: 'note', text: 'x' }],
    ['note empty', { id: 'i', kind: 'note', text: '' }],
    ['note blank', { id: 'i', kind: 'note', text: '   ' }],
    ['note 1001', { id: 'i', kind: 'note', text: 'x'.repeat(1001) }],
    ['text empty', { id: 'i', kind: 'text', question: '' }],
    ['text 301', { id: 'i', kind: 'text', question: 'x'.repeat(301) }],
    ['choices question 301', { id: 'i', kind: 'choices', question: 'x'.repeat(301), options: [{ id: 'o', label: 'x' }] }],
    ['choices without options', { id: 'i', kind: 'choices', question: '', options: [] }],
    ['choices 41 options', {
      id: 'i', kind: 'choices', question: '',
      options: Array.from({ length: 41 }, (_, n) => ({ id: `o${n}`, label: 'x' })),
    }],
    ['choices option 81', { id: 'i', kind: 'choices', question: '', options: [{ id: 'o', label: 'x'.repeat(81) }] }],
    ['choices option empty', { id: 'i', kind: 'choices', question: '', options: [{ id: 'o', label: '' }] }],
    ['choices option without id', { id: 'i', kind: 'choices', question: '', options: [{ id: '', label: 'x' }] }],
    ['rating empty', { id: 'i', kind: 'rating', criterion: '' }],
    ['rating 301', { id: 'i', kind: 'rating', criterion: 'x'.repeat(301) }],
    ['milestone text empty', { id: 'i', kind: 'milestone', text: '', ageLabel: '3;0' }],
    ['milestone text 301', { id: 'i', kind: 'milestone', text: 'x'.repeat(301), ageLabel: '3;0' }],
    ['milestone age empty', { id: 'i', kind: 'milestone', text: 'x', ageLabel: '' }],
    ['milestone age 21', { id: 'i', kind: 'milestone', text: 'x', ageLabel: 'x'.repeat(21) }],
    ['date empty', { id: 'i', kind: 'date', question: '' }],
    ['date 301', { id: 'i', kind: 'date', question: 'x'.repeat(301) }],
  ]
  it.each(invalid)('rejects item %s', (_, item) => {
    expect(code(() => checkContent(withItem(item)))).toBe('form_content_invalid')
  })

  it('rejects duplicate ids across sections, items and options', () => {
    const dupSection = sample()
    dupSection.sections[1]!.id = 's1'
    expect(code(() => checkContent(dupSection))).toBe('form_content_invalid')
    const dupItem = sample()
    dupItem.sections[1]!.items[0]!.id = 't1'
    expect(code(() => checkContent(dupItem))).toBe('form_content_invalid')
    const dupOption = sample()
    const c2 = dupOption.sections[1]!.items[3] as Extract<FormItem, { kind: 'choices' }>
    c2.options[0]!.id = 'o1'
    expect(code(() => checkContent(dupOption))).toBe('form_content_invalid')
    const itemLikeSection = sample()
    itemLikeSection.sections[0]!.items[0]!.id = 's2'
    expect(code(() => checkContent(itemLikeSection))).toBe('form_content_invalid')
  })
})

describe('checkAnswers', () => {
  const content = checkContent(sample())

  it('accepts valid answers and missing ones', () => {
    const answers = {
      t1: 'x'.repeat(4000),
      c1: ['o2', 'o1'],
      r1: { value: '~', remark: 'x'.repeat(500) },
      m1: { reached: true, remark: 'x'.repeat(200) },
      d1: '2026-02-28',
      c2: [],
    }
    expect(checkAnswers(content, answers)).toEqual(answers)
    expect(checkAnswers(content, {})).toEqual({})
    expect(checkAnswers(content, { r1: { value: null, remark: '' }, d1: null }))
      .toEqual({ r1: { value: null, remark: '' }, d1: null })
  })

  it.each([
    ['not an object', null],
    ['an array', []],
    ['an unknown item id', { zz: 'x' }],
    ['a note answer', { n1: 'x' }],
    ['a text of 4001 chars', { t1: 'x'.repeat(4001) }],
    ['a text number', { t1: 5 }],
    ['an option id from another item', { c1: ['o3'] }],
    ['a duplicate option', { c1: ['o1', 'o1'] }],
    ['choices not an array', { c1: 'o1' }],
    ['a rating „x“', { r1: { value: 'x', remark: '' } }],
    ['a rating without remark', { r1: { value: '+' } }],
    ['a rating remark 501', { r1: { value: '+', remark: 'x'.repeat(501) } }],
    ['a rating with extra field', { r1: { value: '+', remark: '', extra: 1 } }],
    ['a milestone reached string', { m1: { reached: 'yes', remark: '' } }],
    ['a milestone remark 201', { m1: { reached: false, remark: 'x'.repeat(201) } }],
    ['an invalid date', { d1: '2026-02-30' }],
    ['a German date', { d1: '28.02.2026' }],
  ])('rejects %s', (_, answers) => {
    expect(code(() => checkAnswers(content, answers))).toBe('form_answer_invalid')
  })

  it('validates against the form snapshot, not the current template', () => {
    const snapshot = checkContent(sample())
    let template = checkContent(sample())
    template = removeItem(template, 't1')
    expect(checkAnswers(snapshot, { t1: 'bleibt' })).toEqual({ t1: 'bleibt' })
    expect(code(() => checkAnswers(template, { t1: 'bleibt' }))).toBe('form_answer_invalid')
  })
})

describe('emptyAnswer', () => {
  it('gives an empty answer per kind', () => {
    const [n1, t1, c1] = sample().sections[0]!.items
    const [r1, m1, d1] = sample().sections[1]!.items
    expect(emptyAnswer(n1!)).toBeNull()
    expect(emptyAnswer(t1!)).toBe('')
    expect(emptyAnswer(c1!)).toEqual([])
    expect(emptyAnswer(r1!)).toEqual({ value: null, remark: '' })
    expect(emptyAnswer(m1!)).toEqual({ reached: false, remark: '' })
    expect(emptyAnswer(d1!)).toBeNull()
  })
})

describe('edit helpers', () => {
  const itemIds = (content: FormContent) => content.sections.map((s) => s.items.map((i) => i.id))

  it('adds, updates, moves and removes sections without mutating', () => {
    const start = sample()
    const added = addSection(start, { title: 'Neu', hint: '' }, ids())
    expect(added.sections.map((s) => s.id)).toEqual(['s1', 's2', 'id1'])
    expect(added.sections[2]).toEqual({ id: 'id1', title: 'Neu', hint: '', items: [] })
    expect(start.sections).toHaveLength(2)

    const updated = updateSection(added, 'id1', { title: 'Ende', hint: 'Hinweis' })
    expect(updated.sections[2]).toMatchObject({ title: 'Ende', hint: 'Hinweis', items: [] })

    expect(moveSection(updated, 'id1', 'up').sections.map((s) => s.id)).toEqual(['s1', 'id1', 's2'])
    expect(moveSection(updated, 's1', 'up').sections.map((s) => s.id)).toEqual(['s1', 's2', 'id1'])
    expect(moveSection(updated, 'id1', 'down').sections.map((s) => s.id)).toEqual(['s1', 's2', 'id1'])
    expect(removeSection(updated, 's1').sections.map((s) => s.id)).toEqual(['s2', 'id1'])
    expect(code(() => removeSection(updated, 'nope'))).toBe('form_section_not_found')
  })

  it('adds items with fresh ids for the item and its options', () => {
    const next = addItem(sample(), 's1', { kind: 'choices', question: 'Neu', options: [{ label: 'Ja' }, { label: 'Nein' }] }, ids())
    expect(next.sections[0]!.items[3]).toEqual({
      id: 'id1', kind: 'choices', question: 'Neu', options: [{ id: 'id2', label: 'Ja' }, { id: 'id3', label: 'Nein' }],
    })
    expect(code(() => addItem(sample(), 'nope', { kind: 'note', text: 'x' }, ids()))).toBe('form_section_not_found')
  })

  it('updates an item keeping its id and existing option ids', () => {
    const next = updateItem(sample(), 'c1', {
      kind: 'choices', question: 'Geändert', options: [{ id: 'o2', label: 'B2' }, { label: 'C' }],
    }, ids())
    expect(next.sections[0]!.items[2]).toEqual({
      id: 'c1', kind: 'choices', question: 'Geändert', options: [{ id: 'o2', label: 'B2' }, { id: 'id1', label: 'C' }],
    })
    expect(updateItem(sample(), 't1', { kind: 'text', question: 'Neu?' }, ids()).sections[0]!.items[1])
      .toEqual({ id: 't1', kind: 'text', question: 'Neu?' })
  })

  it('refuses to change the kind of an item', () => {
    expect(code(() => updateItem(sample(), 't1', { kind: 'note', text: 'x' }, ids()))).toBe('form_item_kind_fixed')
    expect(code(() => updateItem(sample(), 'nope', { kind: 'note', text: 'x' }, ids()))).toBe('form_item_not_found')
  })

  it('moves items within and across sections', () => {
    const content = sample()
    expect(itemIds(moveItem(content, 't1', 'up'))).toEqual([['t1', 'n1', 'c1'], ['r1', 'm1', 'd1', 'c2']])
    expect(itemIds(moveItem(content, 't1', 'down'))).toEqual([['n1', 'c1', 't1'], ['r1', 'm1', 'd1', 'c2']])
    expect(itemIds(moveItem(content, 'c1', 'down'))).toEqual([['n1', 't1'], ['c1', 'r1', 'm1', 'd1', 'c2']])
    expect(itemIds(moveItem(content, 'r1', 'up'))).toEqual([['n1', 't1', 'c1', 'r1'], ['m1', 'd1', 'c2']])
    expect(itemIds(moveItem(content, 'n1', 'up'))).toEqual(itemIds(content))
    expect(itemIds(moveItem(content, 'c2', 'down'))).toEqual(itemIds(content))
    expect(itemIds(content)).toEqual([['n1', 't1', 'c1'], ['r1', 'm1', 'd1', 'c2']])
  })

  it('moves an item into an empty neighbouring section', () => {
    const content = addSection(sample(), { title: 'Leer', hint: '' }, ids())
    expect(itemIds(moveItem(content, 'c2', 'down'))).toEqual([['n1', 't1', 'c1'], ['r1', 'm1', 'd1'], ['c2']])
  })

  it('removes items', () => {
    expect(itemIds(removeItem(sample(), 'm1'))).toEqual([['n1', 't1', 'c1'], ['r1', 'd1', 'c2']])
    expect(code(() => removeItem(sample(), 'nope'))).toBe('form_item_not_found')
    expect(code(() => moveItem(sample(), 'nope', 'up'))).toBe('form_item_not_found')
  })
})
