import { describe, expect, it } from 'vitest'
import type { FormContent, FormSection } from '../../shared/domain/forms'
import type { ChildFormDto, TeamMeetingDto } from '../../shared/types/api'
import {
  blankSheet, childSheet, teamSheet, filledAnswers, isBlank, milestoneColumns, panelDirty, putAnswersTo, saveAnswers, sectionBlocks, sectionHasRating,
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
    expect(sheet.closing).toEqual([])
  })
})

describe('teamSheet', () => {
  const meeting = {
    id: 3, templateId: 1, title: 'Teamsitzung', date: '2026-10-21', start: 13 * 60 + 15, groupId: null, groupName: null,
    participants: 'Anna, Ben', recorder: 'Ben', state: 'draft', releasedAt: null, releasedBy: null,
    reopenReason: null, reopenedAt: null, reopenedBy: null, createdAt: '2026-10-21T11:00:00.000Z', createdBy: 'Anna',
    updatedAt: '2026-10-21T12:00:00.000Z', updatedBy: 'Tablet', content: { sections: [] }, answers: {}, facilityName: 'Kita Sonne', canManage: false,
    signers: [] as TeamMeetingDto['signers'],
  } as TeamMeetingDto

  it('heads the printout with facility, group, date, time, participants and Protokollführung, without signatures', () => {
    const sheet = teamSheet(meeting)
    expect(sheet.header).toEqual([
      ['Einrichtung', 'Kita Sonne'], ['Gruppe', 'ganze Einrichtung'], ['Datum', '21.10.2026'], ['Uhrzeit', '13:15'],
      ['Teilnehmer', 'Anna, Ben'], ['Protokollführung', 'Ben'],
    ])
    expect(sheet.signatures).toEqual([])
    expect(sheet.closing).toEqual(['Entwurf – noch nicht freigegeben'])
    expect(sheet.fileName).toBe('Teamsitzung-2026-10-21')
    expect(teamSheet({ ...meeting, groupId: 4, groupName: 'Bären', start: null }).header.slice(1, 4))
      .toEqual([['Gruppe', 'Bären'], ['Datum', '21.10.2026'], ['Uhrzeit', '']])
  })

  it('names who released it and the last reopening with its reason', () => {
    const released = {
      ...meeting, state: 'released' as const, releasedAt: '2026-10-22T08:30:00.000Z', releasedBy: 'Frau Leitung',
      reopenReason: 'Tippfehler', reopenedAt: '2026-10-21T15:00:00.000Z', reopenedBy: 'Frau Leitung',
    }
    expect(teamSheet(released).closing).toEqual([
      'freigegeben am 22.10.2026, 10:30 von Frau Leitung',
      'zuletzt wieder geöffnet am 21.10.2026, 17:00 von Frau Leitung: Tippfehler',
    ])
  })

  describe('signatures', () => {
    const signer = (employeeId: number | null, name: string, signedAt: string | null) =>
      ({ employeeId, name, signedAt, signedVia: signedAt ? 'login' : null })
    const released = { ...meeting, state: 'released' as const, releasedAt: '2026-10-22T08:30:00.000Z', releasedBy: 'Frau Leitung' }

    it('lists the chosen names, then the typed text, as the participants', () => {
      const sheet = teamSheet({
        ...meeting, participants: 'Frau Weber',
        signers: [signer(1, 'Anna', null), signer(2, 'Ben', null)],
      } as TeamMeetingDto)
      expect(sheet.header[4]).toEqual(['Teilnehmer', 'Anna, Ben, Frau Weber'])
      expect(teamSheet({ ...meeting, participants: '', signers: [signer(1, 'Anna', null)] } as TeamMeetingDto).header[4])
        .toEqual(['Teilnehmer', 'Anna'])
      expect(teamSheet({ ...meeting, participants: '', signers: [] } as TeamMeetingDto).header[4]).toEqual(['Teilnehmer', ''])
    })

    it('prints who signed and when, then who has not signed yet, after the release line', () => {
      const sheet = teamSheet({
        ...released,
        signers: [signer(1, 'Anna', '2026-10-22T09:15:00.000Z'), signer(2, 'Ben', null), signer(3, 'Clara', null)],
      } as TeamMeetingDto)
      expect(sheet.closing).toEqual([
        'freigegeben am 22.10.2026, 10:30 von Frau Leitung',
        'Unterzeichnet: Anna – 22.10.2026, 11:15',
        'Noch nicht unterzeichnet: Ben, Clara',
      ])
    })

    it('leaves out the open line when everyone signed, and the signed lines when nobody did', () => {
      const all = teamSheet({ ...released, signers: [signer(1, 'Anna', '2026-10-22T09:15:00.000Z')] } as TeamMeetingDto)
      expect(all.closing).toEqual(['freigegeben am 22.10.2026, 10:30 von Frau Leitung', 'Unterzeichnet: Anna – 22.10.2026, 11:15'])
      const none = teamSheet({ ...released, signers: [signer(1, 'Anna', null)] } as TeamMeetingDto)
      expect(none.closing).toEqual(['freigegeben am 22.10.2026, 10:30 von Frau Leitung', 'Noch nicht unterzeichnet: Anna'])
    })

    it('does not name anyone as open on a draft, since signing only starts with the release', () => {
      const sheet = teamSheet({ ...meeting, signers: [signer(1, 'Anna', null), signer(2, 'Ben', null)] } as TeamMeetingDto)
      expect(sheet.closing).toEqual(['Entwurf – noch nicht freigegeben'])
    })

    it('does not list a participant who was deleted for good and never signed as open, but does list a signed one', () => {
      const sheet = teamSheet({
        ...released,
        signers: [signer(null, 'Dora', '2026-10-22T09:15:00.000Z'), signer(null, 'Emil', null), signer(2, 'Ben', null)],
      } as TeamMeetingDto)
      expect(sheet.closing).toEqual([
        'freigegeben am 22.10.2026, 10:30 von Frau Leitung',
        'Unterzeichnet: Dora – 22.10.2026, 11:15',
        'Noch nicht unterzeichnet: Ben',
      ])
    })
  })
})

describe('blankSheet', () => {
  const content: FormContent = { sections: [section] }

  it('prints a staff template blank: empty header fields except the facility, no answers, both signatures, no footer', () => {
    const sheet = blankSheet({ kind: 'staff', name: 'Selbstbeurteilung', content }, 'Kita Sonne')
    expect(sheet.header).toEqual([
      ['Name', ''], ['Einrichtung', 'Kita Sonne'], ['Datum', ''], ['Uhrzeit', ''], ['Teilnehmer', ''], ['Zeitraum', ''],
    ])
    expect(sheet.answers).toEqual({})
    expect(sheet.content).toBe(content)
    expect(sheet.signatures).toEqual(['Unterschrift beurteilende Person / Datum', 'Unterschrift Mitarbeiterin / Mitarbeiter / Datum'])
    expect(sheet.blank).toBe(true)
    expect(sheet.fileName).toBe('Vorlage-Selbstbeurteilung')
  })

  it('uses the header and signatures of a child form and of a team meeting', () => {
    expect(blankSheet({ kind: 'child', name: 'Entwicklungsgespräch', content }, 'Kita Sonne').header.map(([label]) => label))
      .toEqual(['Name', 'Geburtsdatum', 'Gruppe', 'Datum', 'Uhrzeit', 'Teilnehmer'])
    const team = blankSheet({ kind: 'team', name: 'Teamsitzung', content }, 'Kita Sonne')
    expect(team.header[0]).toEqual(['Einrichtung', 'Kita Sonne'])
    expect(team.signatures).toEqual(['Unterschrift Protokollführung / Datum', 'Unterschrift Leitung / Datum'])
    expect(team.closing).toEqual([])
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
