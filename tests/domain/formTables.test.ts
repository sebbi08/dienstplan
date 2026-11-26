import { describe, expect, it } from 'vitest'
import { answerDiff, changedItemIds, compareForms, isEmptyAnswer, itemLabel, sameAnswer } from '../../shared/domain/formHistory'
import {
  addItem, checkAnswers, checkContent, emptyAnswer, FormError, tableRowsOf, updateItem, type AnswerableItem, type FormContent,
  type FormItem, type TableItem,
} from '../../shared/domain/forms'
import { itemLabel as accidentItemLabel } from '../../shared/domain/accidents'
import { switchedRowMode, toggledChoice, withTableCell, withTableRow, withoutTableRow } from '../../app/utils/forms'
import { withIds } from '../../server/services/formTemplates'

// „Tabelle“ (fixed and free rows), „Kästchen“ and the Ankreuzliste with „nur eine Antwort“.

const fixed: TableItem = {
  id: 'tf', kind: 'table', question: 'Impfungen',
  columns: [{ id: 'cT', heading: 'Bemerkung', type: 'text' }, { id: 'cC', heading: 'gesehen', type: 'checkbox' }, { id: 'cD', heading: 'am', type: 'date' }],
  rows: [{ id: 'r1', label: 'Masern' }, { id: 'r2', label: 'Tetanus' }],
  freeRows: false,
}
const free: TableItem = {
  id: 'tv', kind: 'table', question: '',
  columns: [{ id: 'vT', heading: 'Was', type: 'text' }, { id: 'vD', heading: 'Wann', type: 'date' }],
  rows: [],
  freeRows: true,
}
const box: AnswerableItem = { id: 'k', kind: 'checkbox', label: 'Impfpass gesehen' }
const single: AnswerableItem = { id: 'c', kind: 'choices', question: 'Essen', options: [{ id: 'o1', label: 'ja' }, { id: 'o2', label: 'nein' }], single: true }

const content = (): FormContent => ({ sections: [{ id: 's', title: 'Gesundheit', hint: '', items: [fixed, free, box, single] }] })
const withItem = (item: Record<string, unknown>): unknown => ({ sections: [{ id: 's', title: 'T', hint: '', items: [item] }] })

const code = (fn: () => unknown): string | undefined => {
  try {
    fn()
  }
  catch (error) {
    if (error instanceof FormError) return error.code
    throw error
  }
  return undefined
}
const cells = (text: string, checked: boolean, date: string | null) => ({ cT: text, cC: checked, cD: date })

describe('checkContent: tables, Kästchen, single choice', () => {
  it('keeps valid items as they are (texts trimmed)', () => {
    expect(checkContent(content())).toEqual(content())
    const trimmed = checkContent(withItem({ ...fixed, question: ' Impfungen ', columns: [{ id: 'a', heading: ' X ', type: 'text' }], rows: [{ id: 'b', label: ' Y ' }] }))
    expect(trimmed.sections[0]!.items[0]).toMatchObject({ question: 'Impfungen', columns: [{ heading: 'X' }], rows: [{ label: 'Y' }] })
  })

  it('stores „nur eine Antwort“ only when set, so the lists from before stay unchanged', () => {
    const multiple = { id: 'c', kind: 'choices', question: '', options: [{ id: 'o', label: 'A' }] }
    expect(checkContent(withItem(multiple)).sections[0]!.items[0]).toEqual(multiple)
    expect(checkContent(withItem({ ...multiple, single: false })).sections[0]!.items[0]).toEqual(multiple)
    expect(checkContent(withItem({ ...multiple, single: true })).sections[0]!.items[0]).toEqual({ ...multiple, single: true })
    expect(code(() => checkContent(withItem({ ...multiple, single: 'yes' })))).toBe('form_content_invalid')
  })

  const columns = (count: number) => Array.from({ length: count }, (_, n) => ({ id: `c${n}`, heading: `S${n}`, type: 'text' }))
  const rows = (count: number) => Array.from({ length: count }, (_, n) => ({ id: `r${n}`, label: `Z${n}` }))

  it('takes 1–8 columns and 1–30 fixed rows at the limits', () => {
    expect(() => checkContent(withItem({ ...fixed, columns: columns(8), rows: rows(30) }))).not.toThrow()
    expect(() => checkContent(withItem({ ...fixed, columns: columns(1), rows: rows(1) }))).not.toThrow()
    expect(() => checkContent(withItem({ ...fixed, question: 'x'.repeat(200), columns: [{ id: 'a', heading: 'x'.repeat(60), type: 'date' }], rows: [{ id: 'b', label: 'x'.repeat(80) }] }))).not.toThrow()
    expect(() => checkContent(withItem({ id: 'k', kind: 'checkbox', label: 'x'.repeat(200) }))).not.toThrow()
  })

  it.each([
    ['no columns', { ...fixed, columns: [] }],
    ['9 columns', { ...fixed, columns: columns(9) }],
    ['31 fixed rows', { ...fixed, rows: rows(31) }],
    ['a fixed table without rows', { ...fixed, rows: [] }],
    ['a free table with rows', { ...free, rows: rows(1) }],
    ['freeRows missing', { ...fixed, freeRows: undefined }],
    ['an unknown column type', { ...fixed, columns: [{ id: 'a', heading: 'A', type: 'number' }] }],
    ['an empty heading', { ...fixed, columns: [{ id: 'a', heading: ' ', type: 'text' }] }],
    ['a heading of 61', { ...fixed, columns: [{ id: 'a', heading: 'x'.repeat(61), type: 'text' }] }],
    ['an empty row label', { ...fixed, rows: [{ id: 'b', label: '' }] }],
    ['a row label of 81', { ...fixed, rows: [{ id: 'b', label: 'x'.repeat(81) }] }],
    ['a question of 201', { ...fixed, question: 'x'.repeat(201) }],
    ['a column id twice', { ...fixed, columns: [{ id: 'a', heading: 'A', type: 'text' }, { id: 'a', heading: 'B', type: 'text' }] }],
    ['a row id equal to a column id', { ...fixed, columns: [{ id: 'a', heading: 'A', type: 'text' }], rows: [{ id: 'a', label: 'Z' }] }],
    ['a column id equal to the item id', { ...fixed, columns: [{ id: 'tf', heading: 'A', type: 'text' }] }],
    ['the column id __proto__', { ...fixed, columns: [{ id: '__proto__', heading: 'A', type: 'text' }] }],
    ['a Kästchen without label', { id: 'k', kind: 'checkbox', label: '' }],
    ['a Kästchen label of 201', { id: 'k', kind: 'checkbox', label: 'x'.repeat(201) }],
  ])('rejects %s', (_, item) => {
    expect(code(() => checkContent(withItem(item as Record<string, unknown>)))).toBe('form_content_invalid')
  })
})

describe('checkAnswers: tables, Kästchen, single choice', () => {
  const form = checkContent(content())

  it('stores a fixed table with every row in the template order, missing cells empty', () => {
    expect(checkAnswers(form, { tf: [{ id: 'r2', cells: { cC: true } }] })).toEqual({
      tf: [{ id: 'r1', cells: cells('', false, null) }, { id: 'r2', cells: cells('', true, null) }],
    })
    const full = [{ id: 'r1', cells: cells('x'.repeat(500), true, '2026-03-01') }, { id: 'r2', cells: cells('', false, null) }]
    expect(checkAnswers(form, { tf: full })).toEqual({ tf: full })
  })

  it('stores free rows in their order, up to 50', () => {
    const rows = Array.from({ length: 50 }, (_, n) => ({ id: `row-${n}`, cells: { vT: `Eintrag ${n}` } }))
    const stored = checkAnswers(form, { tv: rows }).tv as { id: string; cells: Record<string, unknown> }[]
    expect(stored).toHaveLength(50)
    expect(stored[49]).toEqual({ id: 'row-49', cells: { vT: 'Eintrag 49', vD: null } })
    expect(checkAnswers(form, { tv: [] })).toEqual({ tv: [] })
  })

  it('takes Kästchen and single choices', () => {
    expect(checkAnswers(form, { k: true, c: ['o2'] })).toEqual({ k: true, c: ['o2'] })
    expect(checkAnswers(form, { k: false, c: [] })).toEqual({ k: false, c: [] })
  })

  const fiftyOne = Array.from({ length: 51 }, (_, n) => ({ id: `row-${n}`, cells: {} }))
  it.each([
    ['a table that is no list', { tf: {} }],
    ['an unknown fixed row', { tf: [{ id: 'r9', cells: {} }] }],
    ['a fixed row twice', { tf: [{ id: 'r1', cells: {} }, { id: 'r1', cells: {} }] }],
    ['more rows than the fixed table has', { tf: [{ id: 'r1', cells: {} }, { id: 'r2', cells: {} }, { id: 'r1', cells: {} }] }],
    ['51 free rows', { tv: fiftyOne }],
    ['a free row id twice', { tv: [{ id: 'a', cells: {} }, { id: 'a', cells: {} }] }],
    ['an empty free row id', { tv: [{ id: '', cells: {} }] }],
    ['a free row id of 101', { tv: [{ id: 'x'.repeat(101), cells: {} }] }],
    ['a row without cells', { tv: [{ id: 'a' }] }],
    ['a row with an extra key', { tv: [{ id: 'a', cells: {}, label: 'x' }] }],
    ['an unknown column', { tf: [{ id: 'r1', cells: { vT: 'x' } }] }],
    ['a text cell of 501', { tf: [{ id: 'r1', cells: { cT: 'x'.repeat(501) } }] }],
    ['a text cell that is a number', { tf: [{ id: 'r1', cells: { cT: 5 } }] }],
    ['a tick that is a string', { tf: [{ id: 'r1', cells: { cC: 'true' } }] }],
    ['an invalid date cell', { tf: [{ id: 'r1', cells: { cD: '2026-02-30' } }] }],
    ['a German date cell', { tf: [{ id: 'r1', cells: { cD: '01.03.2026' } }] }],
    ['a Kästchen that is no boolean', { k: 'ja' }],
    ['a Kästchen null', { k: null }],
    ['two answers to a single choice', { c: ['o1', 'o2'] }],
  ])('rejects %s', (_, answers) => {
    expect(code(() => checkAnswers(form, answers))).toBe('form_answer_invalid')
  })

  it('keeps several answers of a list with „mehrere Antworten“ (a form made before the switch keeps its own copy)', () => {
    const before = checkContent(withItem({ ...single, single: undefined }))
    expect(checkAnswers(before, { c: ['o1', 'o2'] })).toEqual({ c: ['o1', 'o2'] })
  })

  it('round-trips the empty answers', () => {
    const answers = { tf: emptyAnswer(fixed), tv: emptyAnswer(free), k: emptyAnswer(box), c: emptyAnswer(single) }
    expect(answers.tv).toEqual([])
    expect(answers.k).toBe(false)
    expect(checkAnswers(form, answers)).toEqual(answers)
  })
})

describe('tableRowsOf', () => {
  it('reads fixed tables by the template rows and drops cells of the wrong type', () => {
    expect(tableRowsOf(fixed, [{ id: 'r2', cells: { cT: 7, cC: true, cD: '' } }, { id: 'zz', cells: {} }, 'junk'])).toEqual([
      { id: 'r1', cells: cells('', false, null) }, { id: 'r2', cells: cells('', true, null) },
    ])
    expect(tableRowsOf(free, undefined)).toEqual([])
    expect(tableRowsOf(free, [{ id: 'a', cells: { vT: 'x' } }])).toEqual([{ id: 'a', cells: { vT: 'x', vD: null } }])
  })
})

describe('history of tables and Kästchen', () => {
  const fixedAnswer = (masern: string, seen: boolean) => [{ id: 'r1', cells: cells(masern, seen, null) }, { id: 'r2', cells: cells('', false, null) }]

  it('names the items', () => {
    expect(itemLabel(fixed)).toBe('Impfungen')
    expect(itemLabel(free, 'Bereich')).toBe('Bereich')
    expect(itemLabel(free)).toBe('Was / Wann')
    expect(itemLabel(box)).toBe('Impfpass gesehen')
    expect(accidentItemLabel(box)).toBe('Impfpass gesehen')
    expect(accidentItemLabel(fixed)).toBe('Impfungen')
  })

  it('counts an untouched or emptied table as empty; empty free rows say nothing', () => {
    expect(isEmptyAnswer(fixed, emptyAnswer(fixed))).toBe(true)
    expect(isEmptyAnswer(fixed, fixedAnswer('  ', false))).toBe(true)
    expect(isEmptyAnswer(fixed, fixedAnswer('', true))).toBe(false)
    expect(isEmptyAnswer(free, [{ id: 'a', cells: { vT: '', vD: null } }])).toBe(true)
    expect(sameAnswer(free, [], [{ id: 'a', cells: { vT: ' ', vD: null } }])).toBe(true)
    expect(isEmptyAnswer(box, false)).toBe(true)
    expect(isEmptyAnswer(box, true)).toBe(false)
  })

  it('compares cells regardless of white space', () => {
    expect(sameAnswer(fixed, fixedAnswer('Masern  ok', true), fixedAnswer(' Masern ok', true))).toBe(true)
    expect(sameAnswer(fixed, fixedAnswer('Masern', true), fixedAnswer('Masern', false))).toBe(false)
    expect(sameAnswer(fixed, undefined as never, emptyAnswer(fixed))).toBe(true)
  })

  it('records a save as a change of the item', () => {
    const form = content()
    expect(changedItemIds(form, {}, { tf: emptyAnswer(fixed), tv: [], k: false, c: [] })).toEqual([])
    expect(changedItemIds(form, { k: false }, { k: true, tf: fixedAnswer('x', false) })).toEqual(['tf', 'k'])
  })

  it('diffs a fixed table cell by cell with row label and column', () => {
    const diff = answerDiff(fixed, fixedAnswer('alt', false), [
      { id: 'r1', cells: cells('neu', true, null) }, { id: 'r2', cells: cells('', false, '2026-04-01') },
    ])
    expect(diff).toEqual({
      status: 'changed',
      detail: {
        kind: 'table', addedRows: [], removedRows: [],
        cells: [
          { row: { label: 'Masern', number: 1 }, column: 'Bemerkung', type: 'text', from: 'alt', to: 'neu' },
          { row: { label: 'Masern', number: 1 }, column: 'gesehen', type: 'checkbox', from: false, to: true },
          { row: { label: 'Tetanus', number: 2 }, column: 'am', type: 'date', from: null, to: '2026-04-01' },
        ],
      },
    })
    expect(answerDiff(fixed, emptyAnswer(fixed), fixedAnswer('x', false)).status).toBe('new')
    expect(answerDiff(fixed, fixedAnswer('x', false), emptyAnswer(fixed)).status).toBe('removed')
  })

  it('follows free rows by their id: added, removed and changed rows, empty rows left out', () => {
    const before = [
      { id: 'a', cells: { vT: 'Arzt', vD: null } },
      { id: 'b', cells: { vT: 'Zahnarzt', vD: '2026-01-10' } },
      { id: 'c', cells: { vT: 'Logo', vD: null } },
    ]
    const after = [
      { id: 'a', cells: { vT: 'Kinderarzt', vD: null } },
      { id: 'c', cells: { vT: 'Logo', vD: null } },
      { id: 'd', cells: { vT: 'Ergo', vD: '2026-02-01' } },
      { id: 'e', cells: { vT: '', vD: null } },
    ]
    expect(answerDiff(free, before, after)).toEqual({
      status: 'changed',
      detail: {
        kind: 'table',
        cells: [{ row: { label: null, number: 1 }, column: 'Was', type: 'text', from: 'Arzt', to: 'Kinderarzt' }],
        addedRows: [{ row: { label: null, number: 3 }, cells: [{ column: 'Was', type: 'text', value: 'Ergo' }, { column: 'Wann', type: 'date', value: '2026-02-01' }] }],
        removedRows: [{ row: { label: null, number: 2 }, cells: [{ column: 'Was', type: 'text', value: 'Zahnarzt' }, { column: 'Wann', type: 'date', value: '2026-01-10' }] }],
      },
    })
  })

  it('matches the rows of two Bögen filled in apart (no row in common) in order', () => {
    const older = [{ id: 'x1', cells: { vT: 'U7', vD: null } }, { id: 'x2', cells: { vT: '', vD: null } }, { id: 'x3', cells: { vT: 'Logo', vD: null } }]
    const newer = [{ id: 'y1', cells: { vT: 'U8', vD: null } }, { id: 'y2', cells: { vT: 'Logo', vD: null } }, { id: 'y3', cells: { vT: 'Ergo', vD: null } }]
    expect(answerDiff(free, older, newer)).toEqual({
      status: 'changed',
      detail: {
        kind: 'table',
        cells: [{ row: { label: null, number: 1 }, column: 'Was', type: 'text', from: 'U7', to: 'U8' }],
        addedRows: [{ row: { label: null, number: 3 }, cells: [{ column: 'Was', type: 'text', value: 'Ergo' }] }],
        removedRows: [],
      },
    })
    // The same rows under other ids show the same.
    expect(sameAnswer(free, older, [{ id: 'z1', cells: { vT: 'U7', vD: null } }, { id: 'z3', cells: { vT: 'Logo', vD: null } }])).toBe(true)
  })

  it('diffs a Kästchen like a milestone flag', () => {
    expect(answerDiff(box, false, true)).toEqual({ status: 'new', detail: { kind: 'checkbox', from: false, to: true } })
    expect(answerDiff(box, true, false)).toEqual({ status: 'removed', detail: { kind: 'checkbox', from: true, to: false } })
    expect(answerDiff(box, true, true)).toEqual({ status: 'same' })
  })

  it('compares two forms with the new items side by side', () => {
    const sections = compareForms({ content: content(), answers: { k: true } }, { content: content(), answers: { k: false } })
    expect(sections[0]!.rows.map(row => [row.id, row.older, row.newer, row.trend])).toEqual([
      ['tf', emptyAnswer(fixed), emptyAnswer(fixed), null],
      ['tv', [], [], null],
      ['k', false, true, null],
      ['c', [], [], null],
    ])
  })
})

describe('editor and filler helpers', () => {
  it('ticks single choices like radio buttons that can be cleared', () => {
    expect(toggledChoice([], 'o1', true)).toEqual(['o1'])
    expect(toggledChoice(['o1'], 'o2', true)).toEqual(['o2'])
    expect(toggledChoice(['o2'], 'o2', true)).toEqual([])
    expect(toggledChoice(['o1'], 'o2', false)).toEqual(['o1', 'o2'])
    expect(toggledChoice(['o1', 'o2'], 'o1', false)).toEqual(['o2'])
  })

  it('sets cells and adds and removes free rows up to 50', () => {
    expect(withTableCell(fixed, undefined, 'r2', 'cT', 'x')).toEqual([
      { id: 'r1', cells: cells('', false, null) }, { id: 'r2', cells: cells('x', false, null) },
    ])
    const one = withTableRow(free, [], 'n1')
    expect(one).toEqual([{ id: 'n1', cells: { vT: '', vD: null } }])
    expect(withTableCell(free, one, 'n1', 'vD', '2026-05-05')).toEqual([{ id: 'n1', cells: { vT: '', vD: '2026-05-05' } }])
    expect(withoutTableRow(free, one, 'n1')).toEqual([])
    const fifty = Array.from({ length: 50 }, (_, n) => ({ id: `r${n}`, cells: {} }))
    expect(withTableRow(free, fifty, 'more')).toHaveLength(50)
    expect(withTableRow(fixed, undefined, 'more')).toHaveLength(2)
    expect(withoutTableRow(fixed, undefined, 'r1')).toHaveLength(2)
  })

  it('keeps the fixed rows aside when switching to free rows and back', () => {
    const newId = () => 'new'
    const toFree = switchedRowMode(fixed.rows, true, [], newId)
    expect(toFree).toEqual({ rows: [], stash: fixed.rows })
    expect(switchedRowMode([], false, toFree.stash, newId)).toEqual({ rows: fixed.rows, stash: [] })
    expect(switchedRowMode([], false, [], newId)).toEqual({ rows: [{ id: 'new', label: '' }], stash: [] })
  })

  it('builds tables from drafts with fresh ids for new columns and rows (kept ids stay)', () => {
    let n = 0
    const newId = () => `id${++n}`
    const start: FormContent = { sections: [{ id: 's', title: 'T', hint: '', items: [] }] }
    const added = addItem(start, 's', {
      kind: 'table', question: '', freeRows: false, columns: [{ heading: 'A', type: 'text' }], rows: [{ label: 'Z' }],
    }, newId)
    const item = added.sections[0]!.items[0] as TableItem
    expect(item).toEqual({ id: 'id1', kind: 'table', question: '', freeRows: false, columns: [{ id: 'id2', heading: 'A', type: 'text' }], rows: [{ id: 'id3', label: 'Z' }] })
    const updated = updateItem(added, 'id1', { ...item, freeRows: true, columns: [...item.columns, { heading: 'B', type: 'date' }] }, newId)
    expect(updated.sections[0]!.items[0]).toEqual({
      id: 'id1', kind: 'table', question: '', freeRows: true, rows: [],
      columns: [{ id: 'id2', heading: 'A', type: 'text' }, { id: 'id4', heading: 'B', type: 'date' }],
    })
    expect(code(() => updateItem(added, 'id1', { ...item, rows: [{ id: 'id2', label: 'Z' }] }, newId))).toBe('form_option_duplicate')
  })

  it('gives the server ids to new table columns and rows', () => {
    let n = 0
    const raw = withItem({ id: 'i', kind: 'table', question: '', freeRows: false, columns: [{ heading: 'A', type: 'text' }], rows: [{ id: 'keep', label: 'Z' }] })
    const checked = checkContent(withIds(raw, () => `g${++n}`))
    expect(checked.sections[0]!.items[0]).toEqual({
      id: 'i', kind: 'table', question: '', freeRows: false, columns: [{ id: 'g1', heading: 'A', type: 'text' }], rows: [{ id: 'keep', label: 'Z' }],
    })
  })
})

// The items are part of the FormItem union (TypeScript checks every switch over the kinds).
const _kinds: FormItem['kind'][] = ['table', 'checkbox']
void _kinds
