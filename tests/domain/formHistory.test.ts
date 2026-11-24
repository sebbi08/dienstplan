import { describe, expect, it } from 'vitest'
import {
  answerDiff, changedItemIds, changedSince, compareForms, formDiff, isEmptyAnswer, itemChanges, itemLabel, ratingRank, textDiff, trendOf,
} from '../../shared/domain/formHistory'
import type { AnswerableItem, FormContent } from '../../shared/domain/forms'

const text: AnswerableItem = { id: 't', kind: 'text', question: 'Wie spielt das Kind?' }
const choices: AnswerableItem = {
  id: 'c', kind: 'choices', question: 'Bevorzugt', options: [{ id: 'o1', label: 'Bauecke' }, { id: 'o2', label: 'Malen' }, { id: 'o3', label: 'Draußen' }],
}
const rating: AnswerableItem = { id: 'r', kind: 'rating', criterion: 'Teilt mit anderen' }
const milestone: AnswerableItem = { id: 'm', kind: 'milestone', text: 'Hüpft auf einem Bein', ageLabel: '4;0 Jahre' }
const date: AnswerableItem = { id: 'd', kind: 'date', question: 'Eingewöhnung bis' }

const content: FormContent = {
  sections: [
    { id: 's1', title: 'Spiel', hint: '', items: [{ id: 'n', kind: 'note', text: 'Hinweis' }, text, choices] },
    { id: 's2', title: 'Entwicklung', hint: '', items: [rating, milestone, date] },
  ],
}

describe('changedItemIds', () => {
  it('names only items whose answer really differs; missing answers count as empty, plain and formatted text as equal', () => {
    const filled = { t: '', c: [], r: { value: null, remark: '' }, m: { reached: false, remark: '' }, d: null }
    // The panel sends every item of an untouched form: nothing changed.
    expect(changedItemIds(content, {}, filled)).toEqual([])
    expect(changedItemIds(content, { t: 'Baut gern' }, { t: '<p>Baut gern</p>' })).toEqual([])
    expect(changedItemIds(content, { c: ['o1', 'o2'] }, { c: ['o2', 'o1'] })).toEqual([])
    expect(changedItemIds(content, {}, { ...filled, d: '2026-10-01', t: '<p>neu</p>', r: { value: '+', remark: '' } }))
      .toEqual(['t', 'r', 'd'])
    expect(changedItemIds(content, { m: { reached: true, remark: '' } }, { m: { reached: true, remark: 'sicher' } })).toEqual(['m'])
  })

  it('a change of white space only is no change; a change of formatting is one', () => {
    expect(changedItemIds(content, { t: 'Baut gern' }, { t: 'Baut gern ' })).toEqual([])
    expect(changedItemIds(content, { t: '<p>Baut gern</p>' }, { t: '<p>Baut  gern&nbsp;</p>' })).toEqual([])
    expect(changedItemIds(content, { t: '<p>Baut gern</p>' }, { t: '<p> Baut&nbsp;gern</p>' })).toEqual([])
    expect(changedItemIds(content, { t: '<p>Baut gern</p>' }, { t: '<p>Baut <strong>gern</strong></p>' })).toEqual(['t'])
    expect(changedItemIds(content, { t: '<p>Baut gern</p>' }, { t: '<p>Baut</p><p>gern</p>' })).toEqual(['t'])
  })
})

describe('itemLabel', () => {
  it('names an item by its question, criterion or sentence; choices without a question by their options', () => {
    expect(itemLabel(text)).toBe('Wie spielt das Kind?')
    expect(itemLabel(rating)).toBe('Teilt mit anderen')
    expect(itemLabel(milestone)).toBe('Hüpft auf einem Bein (4;0 Jahre)')
    expect(itemLabel({ ...choices, question: '' } as AnswerableItem)).toBe('Bauecke / Malen / Draußen')
  })
})

describe('itemChanges and changedSince', () => {
  const revisions = [
    { savedAt: '2026-10-20T10:00:00.000Z', savedBy: 'Berta', changedItemIds: ['r'] },
    { savedAt: '2026-10-19T10:00:00.000Z', savedBy: 'Anna', changedItemIds: ['t', 'r'] },
    // The state before the history began: nobody is named for it.
    { savedAt: '2026-10-01T10:00:00.000Z', savedBy: 'Leitung', changedItemIds: [] },
  ]

  it('takes the newest revision naming each item', () => {
    expect(itemChanges(revisions)).toEqual({
      r: { changedAt: '2026-10-20T10:00:00.000Z', changedBy: 'Berta' },
      t: { changedAt: '2026-10-19T10:00:00.000Z', changedBy: 'Anna' },
    })
  })

  it('marks the items changed after the last opening, none on the first opening', () => {
    const changes = itemChanges(revisions)
    expect(changedSince(changes, '2026-10-19T12:00:00.000Z')).toEqual(['r'])
    expect(changedSince(changes, '2026-10-21T00:00:00.000Z')).toEqual([])
    expect(changedSince(changes, null)).toEqual([])
  })
})

describe('textDiff', () => {
  it('diffs word by word', () => {
    expect(textDiff('Das Kind baut gern Türme', 'Das Kind baut sehr gern hohe Türme')).toEqual([
      { op: 'same', text: 'Das Kind baut ' }, { op: 'add', text: 'sehr ' }, { op: 'same', text: 'gern ' },
      { op: 'add', text: 'hohe ' }, { op: 'same', text: 'Türme' },
    ])
    expect(textDiff('alt', 'neu')).toEqual([{ op: 'del', text: 'alt' }, { op: 'add', text: 'neu' }])
    expect(textDiff('', 'neu')).toEqual([{ op: 'add', text: 'neu' }])
    expect(textDiff('gleich', 'gleich')).toEqual([{ op: 'same', text: 'gleich' }])
  })

  it('falls back to lines, then to the whole text, for very long texts', () => {
    const words = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ')
    const before = `${words('a', 700)}\nKopf\n${words('b', 700)}`
    const after = `${words('c', 700)}\nKopf\n${words('d', 700)}`
    const diff = textDiff(before, after)
    expect(diff.map(segment => segment.op)).toEqual(['del', 'add', 'same', 'del', 'add'])
    expect(diff[2]).toEqual({ op: 'same', text: 'Kopf\n' })
    expect(diff.filter(segment => segment.op !== 'add').map(segment => segment.text).join('')).toBe(before)
    expect(diff.filter(segment => segment.op !== 'del').map(segment => segment.text).join('')).toBe(after)
  })
})

describe('answerDiff', () => {
  it('text: new, removed and changed, formatted text as plain text through the sanitizer (no markup survives)', () => {
    expect(answerDiff(text, '', '<p>Baut gern</p>')).toEqual({ status: 'new', detail: { kind: 'text', segments: [{ op: 'add', text: 'Baut gern' }] } })
    expect(answerDiff(text, '<p>Baut gern</p>', '<p></p>')).toMatchObject({ status: 'removed' })
    const diff = answerDiff(text, '<p>Baut <strong>gern</strong></p><script>alert(1)</script>', '<p>Baut nicht <img src=x onerror=alert(1)>gern</p>')
    expect(diff).toEqual({
      status: 'changed',
      detail: { kind: 'text', segments: [{ op: 'same', text: 'Baut ' }, { op: 'add', text: 'nicht ' }, { op: 'same', text: 'gern' }] },
    })
    expect(answerDiff(text, 'Baut gern', '<p>Baut gern</p>')).toEqual({ status: 'same' })
  })

  it('choices: options ticked since and no longer ticked, by label in the item\'s order', () => {
    expect(answerDiff(choices, ['o3', 'o1'], ['o2', 'o1'])).toEqual({
      status: 'changed', detail: { kind: 'choices', added: ['Malen'], removed: ['Draußen'], kept: ['Bauecke'] },
    })
    expect(answerDiff(choices, [], ['o1'])).toMatchObject({ status: 'new' })
    expect(answerDiff(choices, ['o1'], [])).toMatchObject({ status: 'removed' })
  })

  it('rating, milestone and date: old → new', () => {
    expect(answerDiff(rating, { value: '-', remark: '' }, { value: '+', remark: 'viel besser' })).toEqual({
      status: 'changed', detail: { kind: 'rating', from: '-', to: '+', remarkFrom: '', remarkTo: 'viel besser' },
    })
    expect(answerDiff(rating, { value: null, remark: '' }, { value: '~', remark: '' })).toMatchObject({ status: 'new' })
    expect(answerDiff(milestone, { reached: true, remark: '' }, { reached: false, remark: '' })).toEqual({
      status: 'removed', detail: { kind: 'milestone', from: true, to: false, remarkFrom: '', remarkTo: '' },
    })
    expect(answerDiff(date, '2026-10-01', '2026-11-01')).toEqual({
      status: 'changed', detail: { kind: 'date', from: '2026-10-01', to: '2026-11-01' },
    })
    expect(answerDiff(date, null, null)).toEqual({ status: 'same' })
  })

  it('formDiff lists only the differing items', () => {
    expect(Object.keys(formDiff(content, { t: 'a', r: { value: '+', remark: '' } }, { t: 'a', r: { value: '~', remark: '' }, d: '2026-01-01' })))
      .toEqual(['r', 'd'])
  })

  it('empty answers', () => {
    expect(isEmptyAnswer(text, '<p> </p>')).toBe(true)
    expect(isEmptyAnswer(rating, { value: null, remark: 'x' })).toBe(false)
    expect(isEmptyAnswer(milestone, { reached: false, remark: '' })).toBe(true)
  })
})

describe('comparing two forms', () => {
  it('orders the ratings by their scale and milestones reached above not reached', () => {
    expect(ratingRank('+')).toBeGreaterThan(ratingRank('~'))
    expect(ratingRank('~')).toBeGreaterThan(ratingRank('-'))
    // An unknown value (never stored: the answers are checked) ranks below every known one.
    expect(ratingRank('?' as never)).toBeLessThan(ratingRank('-'))
    expect(trendOf(rating, { value: '-', remark: '' }, { value: '~', remark: '' })).toBe('up')
    expect(trendOf(rating, { value: '+', remark: '' }, { value: '-', remark: '' })).toBe('down')
    expect(trendOf(rating, { value: '~', remark: 'a' }, { value: '~', remark: 'b' })).toBe('same')
    expect(trendOf(rating, { value: null, remark: '' }, { value: '+', remark: '' })).toBeNull()
    expect(trendOf(milestone, { reached: false, remark: '' }, { reached: true, remark: '' })).toBe('up')
    expect(trendOf(milestone, { reached: true, remark: '' }, { reached: true, remark: '' })).toBe('same')
    expect(trendOf(text, 'a', 'b')).toBeNull()
    expect(trendOf(rating, undefined, { value: '+', remark: '' })).toBeNull()
  })

  it('lays out by the newer form; items missing in one form are „nicht im Bogen“ (undefined)', () => {
    const extra: AnswerableItem = { id: 'x', kind: 'rating', criterion: 'Neu im Bogen' }
    const gone: AnswerableItem = { id: 'g', kind: 'text', question: 'Nur früher' }
    const goneSection: AnswerableItem = { id: 'h', kind: 'date', question: 'Alter Abschnitt' }
    const newerContent: FormContent = {
      sections: [
        { id: 's1', title: 'Spiel', hint: '', items: [text] },
        { id: 's2', title: 'Entwicklung (neu)', hint: '', items: [rating, extra, milestone] },
      ],
    }
    const olderContent: FormContent = {
      sections: [
        { id: 's1', title: 'Spiel', hint: '', items: [text, gone] },
        { id: 's2', title: 'Entwicklung', hint: '', items: [rating, milestone] },
        { id: 's9', title: 'Früher', hint: '', items: [goneSection] },
      ],
    }
    const sections = compareForms(
      { content: newerContent, answers: { t: 'jetzt', r: { value: '+', remark: '' }, x: { value: '~', remark: '' }, m: { reached: true, remark: '' } } },
      { content: olderContent, answers: { t: 'damals', g: 'alt', r: { value: '~', remark: '' }, h: '2025-01-01' } },
    )
    expect(sections.map(section => [section.title, section.rows.map(row => row.id)])).toEqual([
      ['Spiel', ['t', 'g']], ['Entwicklung (neu)', ['r', 'x', 'm']], ['Früher', ['h']],
    ])
    const [spiel, entwicklung, frueher] = sections
    expect(spiel!.rows[0]).toMatchObject({ newer: 'jetzt', older: 'damals', trend: null })
    expect(spiel!.rows[1]).toMatchObject({ newerItem: undefined, newer: undefined, older: 'alt' })
    expect(entwicklung!.rows.map(row => row.trend)).toEqual(['up', null, 'up'])
    expect(entwicklung!.rows[1]).toMatchObject({ olderItem: undefined, older: undefined })
    // The older form's missing milestone answer is its empty answer (not reached).
    expect(entwicklung!.rows[2]!.older).toEqual({ reached: false, remark: '' })
    expect(frueher!.rows[0]).toMatchObject({ newer: undefined, older: '2025-01-01' })
  })
})
