import { describe, expect, it } from 'vitest'
import type { FormContent, FormSection } from '../../shared/domain/forms'
import type { ChildFormDto } from '../../shared/types/api'
import {
  childSheet, filledAnswers, isBlank, milestoneColumns, panelDirty, putAnswersTo, saveAnswers, sectionBlocks, sectionHasRating,
} from '../../app/utils/forms'

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

describe('milestoneColumns', () => {
  const groups = (...labels: string[]) => labels.map(ageLabel => ({ ageLabel }))
  it('lays out ages like 3;0 … 6;0 as columns', () => {
    expect(milestoneColumns(groups('3;0 Jahre', '4;0 Jahre', '5;0 Jahre', '6;0 Jahre')))
      .toEqual(['3;0 Jahre', '4;0 Jahre', '5;0 Jahre', '6;0 Jahre'])
    expect(milestoneColumns(groups('3;0', '4;6'))).toEqual(['3;0', '4;6'])
  })
  it('keeps other labels, a single age or too many ages as grouped rows', () => {
    expect(milestoneColumns(groups('3;0 Jahre', 'ab 4 Jahren'))).toBeNull()
    expect(milestoneColumns(groups('3;0 Jahre'))).toBeNull()
    expect(milestoneColumns(groups('1;0', '2;0', '3;0', '4;0', '5;0', '6;0', '7;0'))).toBeNull()
  })
})

describe('childSheet', () => {
  it('heads the printout with the child and the meeting data and signs by educator and parents', () => {
    const data = {
      id: 7, title: 'Entwicklungsgespräch', content: { sections: [] }, answers: {}, updatedAt: '2026-10-20T10:00:00.000Z', updatedBy: 'Anna',
      date: '2026-10-20', start: 14 * 60 + 30, participants: 'Mama, Anna',
      child: { firstName: 'Lena', lastName: 'Kurz', birthDate: '2021-05-03', groupName: 'Bären' }, facilityName: 'Kita',
    } as unknown as ChildFormDto
    const sheet = childSheet(data)
    expect(sheet.header).toEqual([
      ['Name', 'Lena Kurz'], ['Geburtsdatum', '03.05.2021'], ['Gruppe', 'Bären'], ['Datum', '20.10.2026'],
      ['Uhrzeit', '14:30'], ['Teilnehmer', 'Mama, Anna'],
    ])
    expect(sheet.signatures).toEqual(['Unterschrift Fachkraft / Datum', 'Unterschrift Erziehungsberechtigte / Datum'])
    // The file name (and so the PDF request's query) never carries the child's name.
    expect(sheet.fileName).toBe('Beobachtung-7-2026-10-20')
    expect(sheet.fileName).not.toMatch(/Lena|Kurz/)
  })
})

describe('the form panel save contract', () => {
  it('PUTs the answers with the updatedAt they are based on', async () => {
    const calls: unknown[] = []
    const save = putAnswersTo('/api/x/1', async (url, options) => {
      calls.push([url, options])
      return { updatedAt: 'T2' }
    })
    expect(await saveAnswers(save, { a: 'x' }, 'T1')).toEqual({ ok: true, base: 'T2' })
    expect(calls).toEqual([['/api/x/1', { method: 'PUT', body: { answers: { a: 'x' }, expectedUpdatedAt: 'T1' } }]])
  })

  it('tells a 409 form_changed apart from other failures', async () => {
    const failing = (code: string) => saveAnswers(async () => {
      throw { data: { data: { code } } }
    }, {}, 'T1')
    expect(await failing('form_changed')).toMatchObject({ ok: false, conflict: true })
    expect(await failing('forbidden')).toMatchObject({ ok: false, conflict: false })
  })

  it('counts the parent fields as unsaved, and nothing while read-only', () => {
    expect(panelDirty(true, '{}', '{}', false)).toBe(false)
    expect(panelDirty(true, '{"a":1}', '{}', false)).toBe(true)
    expect(panelDirty(true, '{}', '{}', true)).toBe(true)
    expect(panelDirty(false, '{"a":1}', '{}', true)).toBe(false)
  })
})
