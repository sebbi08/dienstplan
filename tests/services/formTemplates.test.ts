import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { forms, formStarterSeeds, formTemplates } from '../../server/db/schema'
import { seedDefaults } from '../../server/db/seed'
import { createFacility } from '../../server/services/facilities'
import { exampleCategoryOf } from '../../server/services/formTemplateCategories'
import {
  copyTemplate, createTemplate, deleteTemplate, listTemplates, seedPendingStarterTemplates, seedStarterTemplates,
  updateTemplate, withFormErrors,
} from '../../server/services/formTemplates'
import { orderEntries } from '../../server/services/printTemplates'
import { listTeamMeetings } from '../../server/services/teamMeetings'
import type { ServiceError } from '../../server/lib/errors'
import { checkContent, FormError, type FormContent } from '../../shared/domain/forms'
import {
  ACCIDENT_STARTERS, CHILD_STARTERS, RATING_LEGEND, STAFF_STARTERS, starterContent, TEAM_STARTERS,
} from '../../shared/domain/forms/starters'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

let db: Db
let leitung: SessionUser
const now = new Date('2026-10-26T09:00:00.000Z')

beforeEach(() => {
  db = createTestDb()
  leitung = addUser(db, 'leitung', 'admin', addEmployee(db, 'Anna Leitung'))
})

const seeds = (facilityId: number) => db.select({ key: formStarterSeeds.starterKey }).from(formStarterSeeds)
  .where(eq(formStarterSeeds.facilityId, facilityId)).all().map(row => row.key).filter(key => key !== 'categories').sort()
const own = (facilityId = 1) => listTemplates(db, facilityId).filter(template => template.starterKey === null)
/** A facility as the versions before 0108 created it: every starter template created and recorded. */
const oldFacility = (name: string) => {
  const id = createFacility(db, name).id
  db.delete(formTemplates).where(eq(formTemplates.facilityId, id)).run()
  db.delete(formStarterSeeds).where(eq(formStarterSeeds.facilityId, id)).run()
  seedStarterTemplates(db, id, now)
  return id
}
const create = (name: string, kind: 'staff' | 'child' | 'team' = 'staff', facilityId = 1) =>
  createTemplate(db, leitung, facilityId, { kind, name, selfAssessment: false }, now)
const allIds = (content: FormContent) => content.sections.flatMap(section => [
  section.id, ...section.items.flatMap(item => [item.id, ...(item.kind === 'choices' ? item.options.map(option => option.id) : [])]),
])
const sample = {
  sections: [{
    title: ' Bereich ', items: [
      { kind: 'text', question: 'Wie geht es dir?' },
      { kind: 'choices', question: '', options: [{ label: 'Ja' }, { label: 'Nein' }] },
    ],
  }],
}
const addForm = (templateId: number) => db.insert(forms).values({
  facilityId: 1, templateId, kind: 'staff', title: 'x', content: '{"sections":[]}', createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
}).run()

describe('starter templates', () => {
  it('are valid content with the texts of the paper forms', () => {
    let next = 0
    const [self, assessment] = STAFF_STARTERS.map(starter => checkContent(starterContent(starter, () => `id${next++}`)))
    expect(self!.sections.map(section => section.title)).toEqual([
      'Phase 1: Einstieg & Ankommen', 'Phase 2: Rückblick & Arbeitsalltag (Reflexion)', 'Phase 3: Zusammenarbeit im Team & mit der Leitung',
      'Phase 4: Rahmenbedingungen & Arbeitsbelastung', 'Phase 5: Kompetenzen & Fortbildung',
      'Phase 6: Ziele & Vereinbarungen für das nächste Jahr', 'Phase 7: Abschluss',
    ])
    expect(self!.sections[5]!.items.map(item => item.kind)).toEqual(['note', 'text', 'text', 'text', 'text'])
    expect(self!.sections[5]!.items.slice(1, 4).map(item => item.kind === 'text' && item.question)).toEqual(['Ziel 1', 'Ziel 2', 'Ziel 3'])
    expect(self!.sections[6]!.items.at(-1)).toMatchObject({ kind: 'text', question: 'Anmerkungen' })
    expect(assessment!.sections).toHaveLength(12)
    // The legend is shown by the form above every section with ratings, not stored as a note.
    expect(assessment!.sections.flatMap(section => section.items).some(item => item.kind === 'note')).toBe(false)
    expect(RATING_LEGEND.entries.map(entry => entry.value)).toEqual(['+', '~', '-'])
    expect(assessment!.sections.slice(0, 11).flatMap(section => section.items).filter(item => item.kind === 'rating')).toHaveLength(47)
    expect(assessment!.sections[11]).toMatchObject({ title: 'Zusammenfassung und Vereinbarungen' })
    expect(assessment!.sections[11]!.items.map(item => item.kind)).toEqual(['text', 'text', 'text', 'text'])
  })

  it('the Entwicklungsgespräch has the sections of the paper form and its milestones in the age column of the table', () => {
    let next = 0
    const content = checkContent(starterContent(CHILD_STARTERS[0]!, () => `id${next++}`))
    expect(content.sections.map(section => section.title)).toEqual([
      'Stärken & Persönlichkeit', 'Soziales Verhalten', 'Spiel & Lernen & Freispiel', 'Emotionale Entwicklung',
      'Selbstständigkeit', 'Entwicklungsschwerpunkte', 'Vorschule', 'Projekte', 'Essen', 'Motorik',
      'Sprechen, Sehen, Hören', 'Kognitive Entwicklung',
    ])
    const items = (title: string) => content.sections.find(section => section.title === title)!.items
    // The header box „Angaben zum Kind“ is the form's header, never an item.
    expect(content.sections.flatMap(section => section.items).some(item => item.kind === 'note' || item.kind === 'date')).toBe(false)
    expect(items('Stärken & Persönlichkeit').map(item => item.kind)).toEqual(['choices', 'text'])
    expect(items('Stärken & Persönlichkeit')[1]).toMatchObject({ question: 'Besondere Stärken' })
    expect(items('Spiel & Lernen & Freispiel').map(item => item.kind)).toEqual(['choices', 'choices', 'text'])
    expect(items('Spiel & Lernen & Freispiel')[0]).toMatchObject({ question: 'Interessen' })
    expect(items('Entwicklungsschwerpunkte')[1]).toMatchObject({ kind: 'text', question: 'Förderziel' })
    expect(items('Essen').map(item => item.kind)).toEqual(['choices'])
    const firstChoices = items('Stärken & Persönlichkeit')[0]!
    expect(firstChoices.kind === 'choices' && firstChoices.options.map(option => option.label)).toEqual([
      'selbstbewusst', 'neugierig', 'kreativ', 'ruhig', 'hilfsbereit', 'sensibel', 'kontaktfreudig', 'ausdauernd',
      'humorvoll', 'vorsichtig', 'bewegungsfreudig',
    ])

    const ageOf = (title: string, start: string) => {
      const item = items(title).find(entry => entry.kind === 'milestone' && entry.text.startsWith(start))
      return item?.kind === 'milestone' ? item.ageLabel : null
    }
    // Checked against the shaded cell of each row in the docx table (word/document.xml).
    expect(ageOf('Motorik', 'Beidbeiniges Abhüpfen')).toBe('3;0 Jahre')
    expect(ageOf('Motorik', 'Treppen im Wechselschritt')).toBe('4;0 Jahre')
    expect(ageOf('Motorik', 'Treppen werden beim Hoch- und Herabsteigen')).toBe('5;0 Jahre')
    expect(ageOf('Motorik', 'Einzelne Buchstaben')).toBe('5;0 Jahre')
    expect(ageOf('Motorik', 'Sicheres Stehen auf dem linken und dem rechten Bein')).toBe('6;0 Jahre')
    expect(ageOf('Motorik', 'Stift ruht auf dem Mittelfinger')).toBe('6;0 Jahre')
    expect(ageOf('Sprechen, Sehen, Hören', 'Singt einfache Melodien')).toBe('3;0 Jahre')
    expect(ageOf('Sprechen, Sehen, Hören', 'In kleinen Sätzen')).toBe('5;0 Jahre')
    expect(ageOf('Kognitive Entwicklung', 'Viele W-Fragen')).toBe('4;0 Jahre')
    expect(ageOf('Kognitive Entwicklung', 'Kreis, Dreieck, Quadrat')).toBe('6;0 Jahre')
    const count = (title: string) => {
      const labels = items(title).map(item => (item.kind === 'milestone' ? item.ageLabel : ''))
      return ['3;0 Jahre', '4;0 Jahre', '5;0 Jahre', '6;0 Jahre'].map(label => labels.filter(value => value === label).length)
    }
    expect(count('Motorik')).toEqual([4, 5, 4, 6])
    expect(count('Sprechen, Sehen, Hören')).toEqual([5, 4, 2, 3])
    expect(count('Kognitive Entwicklung')).toEqual([3, 2, 2, 3])
  })

  it('the Teamsitzung has five sections, each one free text with its own short question', () => {
    let next = 0
    const content = checkContent(starterContent(TEAM_STARTERS[0]!, () => `id${next++}`))
    expect(TEAM_STARTERS.map(starter => [starter.key, starter.kind, starter.name])).toEqual([['team_meeting', 'team', 'Teamsitzung']])
    const titles = ['Tagesordnung', 'Themen und Ergebnisse', 'Vereinbarungen und Aufgaben (wer, was, bis wann)', 'Termine', 'Sonstiges']
    expect(content.sections.map(section => section.title)).toEqual(titles)
    expect(content.sections.map(section => section.items.map(item => item.kind === 'text' && item.question)))
      .toEqual([
        ['Welche Punkte stehen an?'], ['Was wurde besprochen und entschieden?'], ['Wer erledigt was bis wann?'],
        ['Welche Termine stehen an?'], ['Weitere Notizen'],
      ])
  })

  it('a facility seeded before the team meetings gets only the Teamsitzung added, once', () => {
    const old = oldFacility('Alt')
    db.delete(formTemplates).where(and(eq(formTemplates.facilityId, old), eq(formTemplates.kind, 'team'))).run()
    db.delete(formStarterSeeds).where(and(eq(formStarterSeeds.facilityId, old), eq(formStarterSeeds.starterKey, 'team_meeting'))).run()

    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old, 'team').map(template => [template.name, template.starterKey])).toEqual([['Teamsitzung', 'team_meeting']])
    expect(listTemplates(db, old)).toHaveLength(6)
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
  })

  it('a new facility gets only the accident starters, with fresh ids, and records every key as given', () => {
    const id = createFacility(db, 'Krippe').id
    const list = listTemplates(db, id)
    expect(list.map(template => [template.name, template.kind, template.starterKey, template.selfAssessment, template.subject])).toEqual([
      ['Unfallbericht Kind', 'accident', 'accident_child', false, 'child'],
      ['Unfallanzeige (U 1000)', 'accident', 'accident_u1000', false, 'employee'],
    ])
    expect(new Set(allIds(list[0]!.content)).size).toBe(allIds(list[0]!.content).length)
    expect(allIds(listTemplates(db, 1, 'accident')[0]!.content)).not.toEqual(allIds(list[0]!.content))
    // The skipped starters are recorded too, so the startup step does not add them later.
    expect(seeds(id)).toEqual(['accident_child', 'accident_u1000', 'child_development', 'staff_assessment', 'staff_self_assessment', 'team_meeting'])
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
    seedDefaults(db)
    expect(listTemplates(db, id).map(template => template.starterKey)).toEqual(['accident_child', 'accident_u1000'])
    // Existing facilities keep all of theirs.
    expect(listTemplates(db, 1)).toHaveLength(6)
  })

  it('a facility seeded with the staff starters only gets the child starter added, once', () => {
    const old = oldFacility('Alt')
    // As 0056 leaves a facility that had the staff starters: the child starter is neither there nor recorded.
    db.delete(formTemplates).where(and(eq(formTemplates.facilityId, old), eq(formTemplates.kind, 'child'))).run()
    db.delete(formStarterSeeds).where(and(eq(formStarterSeeds.facilityId, old), eq(formStarterSeeds.starterKey, 'child_development'))).run()
    const [self] = listTemplates(db, old).filter(template => template.starterKey === 'staff_self_assessment')
    deleteTemplate(db, old, self!.id)

    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    // In the order of the example categories (Kinder, Fachkräfte, Team, Unfälle).
    const kept = ['child_development', 'staff_assessment', 'team_meeting', 'accident_child', 'accident_u1000']
    expect(listTemplates(db, old).map(template => template.starterKey)).toEqual(kept)
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
    seedDefaults(db)
    expect(listTemplates(db, old).map(template => template.starterKey)).toEqual(kept)
  })

  it('existing facilities are seeded once at startup; renamed or deleted starters are not created again', () => {
    // A facility from before the forms: no templates, nothing recorded.
    const old = oldFacility('Alt')
    db.delete(formTemplates).where(eq(formTemplates.facilityId, old)).run()
    db.delete(formStarterSeeds).where(eq(formStarterSeeds.facilityId, old)).run()
    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old).map(template => template.starterKey))
      .toEqual(['child_development', 'staff_self_assessment', 'staff_assessment', 'team_meeting', 'accident_child', 'accident_u1000'])

    const [self, ...others] = listTemplates(db, old).filter(template => template.starterKey === 'staff_self_assessment')
      .concat(listTemplates(db, old).filter(template => template.starterKey !== 'staff_self_assessment'))
    updateTemplate(db, leitung, old, self!.id, { name: 'Meine Selbstbeurteilung' }, now)
    for (const other of others) deleteTemplate(db, old, other.id)
    seedDefaults(db)
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
    expect(listTemplates(db, old).map(template => template.name)).toEqual(['Meine Selbstbeurteilung'])
  })

  it('a starter template already there is only recorded, not created twice', () => {
    const old = oldFacility('Alt')
    db.delete(formStarterSeeds).where(eq(formStarterSeeds.facilityId, old)).run()
    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old)).toHaveLength(6)
    expect(seeds(old)).toHaveLength(6)
  })

  it('facility 1 of a fresh database is seeded by the startup step', () => {
    expect(listTemplates(db, 1, 'staff').map(template => template.starterKey)).toEqual(['staff_self_assessment', 'staff_assessment'])
    expect(listTemplates(db, 1, 'child').map(template => template.starterKey)).toEqual(['child_development'])
    expect(listTemplates(db, 1, 'accident').map(template => template.starterKey)).toEqual(['accident_child', 'accident_u1000'])
  })

  it('a facility seeded before the accident reports gets both accident starters added, once (idempotent)', () => {
    const old = oldFacility('Alt')
    db.delete(formTemplates).where(and(eq(formTemplates.facilityId, old), eq(formTemplates.kind, 'accident'))).run()
    db.delete(formStarterSeeds).where(and(eq(formStarterSeeds.facilityId, old), eq(formStarterSeeds.starterKey, 'accident_child'))).run()
    db.delete(formStarterSeeds).where(and(eq(formStarterSeeds.facilityId, old), eq(formStarterSeeds.starterKey, 'accident_u1000'))).run()

    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old, 'accident').map(template => [template.name, template.subject]))
      .toEqual([['Unfallbericht Kind', 'child'], ['Unfallanzeige (U 1000)', 'employee']])
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
    seedDefaults(db)
    expect(listTemplates(db, old, 'accident')).toHaveLength(2)
  })
})

describe('accident starters', () => {
  const contentOf = (index: number) => {
    let next = 0
    return checkContent(starterContent(ACCIDENT_STARTERS[index]!, () => `id${next++}`))
  }
  const labelOf = (item: FormContent['sections'][number]['items'][number]) =>
    item.kind === 'note' ? item.text : item.kind === 'rating' ? item.criterion : item.kind === 'milestone' ? item.text : item.question

  it('the child report asks the brief\'s questions as free texts', () => {
    const items = contentOf(0).sections.flatMap(section => section.items)
    expect(items.map(item => [item.kind, labelOf(item)])).toEqual([
      ['text', 'Unfallort'], ['text', 'Hergang – Was ist passiert?'], ['text', 'Verletzung (Art und Körperteil)'],
      ['text', 'Erste Hilfe – durch wen?'], ['text', 'Erste Hilfe – welche Maßnahmen?'], ['text', 'Zeugen'],
      ['text', 'Eltern informiert – wann und durch wen?'], ['text', 'Bemerkungen'],
    ])
  })

  it('the U 1000 has one item per numbered field 1–29 with the official labels and its prefill keys', () => {
    const items = contentOf(1).sections.flatMap(section => section.items)
    const numbered = items.map(labelOf).map(label => /^(\d+) /.exec(label)?.[1]).filter(Boolean).map(Number)
    expect(numbered).toEqual(Array.from({ length: 29 }, (_, index) => index + 1))
    const byNumber = (n: number) => items.find(item => labelOf(item).startsWith(`${n} `))!
    expect(labelOf(byNumber(1))).toBe('1 Name und Anschrift des Unternehmens')
    expect(byNumber(5)).toMatchObject({ kind: 'date', question: '5 Geburtsdatum', prefill: 'birthDate' })
    expect(byNumber(7)).toMatchObject({ kind: 'choices', options: [{ label: 'Männlich' }, { label: 'Weiblich' }, { label: 'Divers' }, { label: 'Keine Angabe' }] })
    expect(byNumber(15).kind).toBe('note')
    expect(byNumber(17)).toMatchObject({ kind: 'choices', prefill: 'homeOffice', options: [{ label: 'Nein' }, { label: 'Ja' }] })
    expect(byNumber(11)).toMatchObject({ options: expect.arrayContaining([{ id: expect.any(String), label: 'mit der Unternehmerin/dem Unternehmer in eingetragener Lebenspartnerschaft lebend' }]) })
    expect(byNumber(27)).toMatchObject({ kind: 'choices', options: [{ label: 'Nein' }, { label: 'Sofort' }, { label: 'Später' }] })
    expect(Object.fromEntries(items.flatMap(item => ('prefill' in item && item.prefill ? [[item.prefill, Number(labelOf(item).split(' ')[0])]] : []))))
      .toEqual({
        facility: 1, personName: 4, birthDate: 5, address: 6, healthInsurer: 13, homeOffice: 17, workingTime: 23, jobTitle: 24,
        employedSince: 25, group: 26, facilityPhone: 29,
      })
  })

  it('prefill keys are checked: known, on an item of their kind; copies keep them', () => {
    const bad = (item: object) => () => checkContent({ sections: [{ id: 's', title: 'A', hint: '', items: [{ id: 'i', ...item }] }] })
    expect(bad({ kind: 'text', question: 'Name', prefill: 'nope' })).toThrow(FormError)
    expect(bad({ kind: 'date', question: 'Name', prefill: 'personName' })).toThrow(FormError)
    expect(bad({ kind: 'note', text: 'x', prefill: 'personName' })).not.toThrow()
    expect(bad({ kind: 'text', question: 'Name', prefill: 'personName' })().sections[0]!.items[0]).toEqual({ id: 'i', kind: 'text', question: 'Name', prefill: 'personName' })
    const u1000 = listTemplates(db, 1, 'accident').find(template => template.starterKey === 'accident_u1000')!
    const copyId = copyTemplate(db, leitung, 1, u1000.id, now)
    const copy = listTemplates(db, 1, 'accident').find(template => template.id === copyId)!
    expect(copy.subject).toBe('employee')
    // The copy keeps the official print layout.
    expect([u1000.printLayout, copy.printLayout]).toEqual(['u1000', 'u1000'])
    expect(copy.content.sections.flatMap(section => section.items).filter(item => 'prefill' in item && item.prefill)).toHaveLength(11)
  })
})

describe('form templates', () => {
  it('creates, lists per kind and updates a template', () => {
    const id = create(' Probezeit ')
    create('Entwicklung', 'child')
    expect(own().map(template => [template.name, template.kind])).toEqual([['Probezeit', 'staff'], ['Entwicklung', 'child']])
    expect(listTemplates(db, 1, 'child').map(template => template.name)).toEqual(['Entwicklungsgespräch', 'Entwicklung'])
    expect(own()[0]).toMatchObject({ content: { sections: [] }, archived: false, inUse: false, updatedBy: 'Anna Leitung' })

    const later = new Date('2026-10-27T10:00:00.000Z')
    updateTemplate(db, leitung, 1, id, { name: 'Probezeit-Gespräch', selfAssessment: true, content: sample }, later)
    const saved = own().find(template => template.id === id)!
    expect(saved).toMatchObject({ name: 'Probezeit-Gespräch', selfAssessment: true, updatedAt: later.toISOString() })
    expect(saved.content.sections[0]!.title).toBe('Bereich')
    expect(allIds(saved.content)).toHaveLength(5)
    expect(allIds(saved.content).every(value => /^[0-9a-f-]{36}$/.test(value))).toBe(true)

    // Saving again keeps the ids; a new item gets one.
    const content = structuredClone(saved.content) as unknown as { sections: { items: unknown[] }[] }
    content.sections[0]!.items.push({ kind: 'note', text: 'Hinweis' })
    updateTemplate(db, leitung, 1, id, { content }, later)
    const again = own().find(template => template.id === id)!
    expect(allIds(again.content).slice(0, 5)).toEqual(allIds(saved.content))
    expect(allIds(again.content)).toHaveLength(6)

    updateTemplate(db, leitung, 1, id, { archived: true }, later)
    expect(own().map(template => template.name)).toEqual(['Entwicklung', 'Probezeit-Gespräch'])
  })

  it('refuses an editor save over a newer save of someone else (409 form_template_changed)', () => {
    const id = create('Probezeit')
    const loaded = own().find(template => template.id === id)!.updatedAt
    updateTemplate(db, leitung, 1, id, { name: 'Erste', expectedUpdatedAt: loaded }, new Date('2026-10-27T10:00:00.000Z'))
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { name: 'Zweite', expectedUpdatedAt: loaded }))).toBe('form_template_changed')
    const fresh = own().find(template => template.id === id)!
    expect(fresh.name).toBe('Erste')
    updateTemplate(db, leitung, 1, id, { name: 'Zweite', expectedUpdatedAt: fresh.updatedAt })
    expect(own().find(template => template.id === id)!.name).toBe('Zweite')
  })

  it('an accident template names its subject (child or employee); the other kinds have none', () => {
    expect(errorCode(() => createTemplate(db, leitung, 1, { kind: 'accident', name: 'Unfall', selfAssessment: false }, now))).toBe('form_subject_invalid')
    expect(errorCode(() => createTemplate(db, leitung, 1, { kind: 'accident', name: 'Unfall', selfAssessment: false, subject: 'parent' }, now)))
      .toBe('form_subject_invalid')
    const id = createTemplate(db, leitung, 1, { kind: 'accident', name: 'Unfall', selfAssessment: true, subject: 'employee' }, now)
    expect(own().find(template => template.id === id)).toMatchObject({ kind: 'accident', subject: 'employee', selfAssessment: false })
    const team = createTemplate(db, leitung, 1, { kind: 'team', name: 'Sitzung', selfAssessment: false, subject: 'child' }, now)
    expect(own().find(template => template.id === team)!.subject).toBeNull()
  })

  it('self-assessment is only for staff templates', () => {
    const id = createTemplate(db, leitung, 1, { kind: 'team', name: 'Sitzung', selfAssessment: true }, now)
    expect(own().find(template => template.id === id)!.selfAssessment).toBe(false)
  })

  it('names are unique per facility and kind, case-insensitive, 1–80 chars', () => {
    create('Probezeit')
    expect(errorCode(() => create(' PROBEZEIT '))).toBe('form_template_name_taken')
    expect(errorCode(() => create('selbstbeurteilung'))).toBe('form_template_name_taken')
    expect(create('Probezeit', 'child')).toBeGreaterThan(0)
    const other = createFacility(db, 'Krippe').id
    expect(create('Probezeit', 'staff', other)).toBeGreaterThan(0)
    expect(errorCode(() => create('  '))).toBe('form_template_name_required')
    expect(errorCode(() => create('x'.repeat(81)))).toBe('form_template_name_too_long')
    const id = create('x'.repeat(80))
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { name: 'probezeit' }, now))).toBe('form_template_name_taken')
    updateTemplate(db, leitung, 1, id, { name: 'X'.repeat(80) }, now)
  })

  it('rejects invalid content and maps edit errors', () => {
    const id = create('Probezeit')
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { content: { sections: [{ title: '', items: [] }] } }, now)))
      .toBe('form_content_invalid')
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { content: 'nope' }, now))).toBe('form_content_invalid')
    const duplicate = { sections: [{ id: 'a', title: 'A', items: [{ id: 'a', kind: 'note', text: 'x' }] }] }
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { content: duplicate }, now))).toBe('form_content_invalid')
    expect(own()[0]!.content).toEqual({ sections: [] })
  })

  it('refuses a kept item id with another kind', () => {
    const id = create('Probezeit')
    updateTemplate(db, leitung, 1, id, { content: sample }, now)
    const saved = own()[0]!.content
    const changed = structuredClone(saved) as unknown as { sections: { items: Record<string, unknown>[] }[] }
    const item = changed.sections[0]!.items[0]!
    changed.sections[0]!.items[0] = { id: item.id, kind: 'note', text: 'Wie geht es dir?' }
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { content: changed }, now))).toBe('form_item_kind_fixed')
    expect(own()[0]!.content).toEqual(saved)
    // Deleting the item and adding a new one of the other kind is fine.
    changed.sections[0]!.items[0] = { kind: 'note', text: 'Wie geht es dir?' }
    updateTemplate(db, leitung, 1, id, { content: changed }, now)
    expect(own()[0]!.content.sections[0]!.items[0]).toMatchObject({ kind: 'note' })
  })

  it('keeps a table column\'s type once forms were made from the template; new columns take any type', () => {
    const id = create('Gesundheitscheck')
    updateTemplate(db, leitung, 1, id, {
      content: { sections: [{ title: 'G', items: [{ kind: 'table', question: '', freeRows: true, columns: [{ heading: 'Was', type: 'text' }], rows: [] }] }] },
    }, now)
    type Editable = { sections: { items: { columns: { id?: string; heading: string; type: string }[] }[] }[] }
    const columnsOf = () => (structuredClone(own().find(template => template.id === id)!.content) as unknown as Editable)
    // Not in use yet: the type may still change.
    const draft = columnsOf()
    draft.sections[0]!.items[0]!.columns[0]!.type = 'date'
    updateTemplate(db, leitung, 1, id, { content: draft }, now)
    expect(columnsOf().sections[0]!.items[0]!.columns[0]!.type).toBe('date')

    addForm(id)
    const locked = columnsOf()
    locked.sections[0]!.items[0]!.columns[0]!.type = 'text'
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { content: locked }, now))).toBe('form_column_type_fixed')
    expect(columnsOf().sections[0]!.items[0]!.columns[0]!.type).toBe('date')
    // A new heading and a new column of any type are fine.
    const grown = columnsOf()
    grown.sections[0]!.items[0]!.columns[0]!.heading = 'Wann'
    grown.sections[0]!.items[0]!.columns.push({ heading: 'gesehen', type: 'checkbox' })
    updateTemplate(db, leitung, 1, id, { content: grown }, now)
    expect(columnsOf().sections[0]!.items[0]!.columns.map(column => [column.heading, column.type])).toEqual([['Wann', 'date'], ['gesehen', 'checkbox']])
  })

  it('writes nothing when no field changes', () => {
    const id = create('Probezeit')
    updateTemplate(db, leitung, 1, id, { content: sample }, now)
    const before = own()[0]!
    const other = addUser(db, 'traeger', 'provider')
    const later = new Date('2026-10-28T10:00:00.000Z')
    updateTemplate(db, other, 1, id, {}, later)
    updateTemplate(db, other, 1, id, {
      name: ' Probezeit ', archived: false, selfAssessment: false, content: structuredClone(before.content),
    }, later)
    expect(own()[0]).toEqual(before)
    updateTemplate(db, other, 1, id, { archived: true }, later)
    expect(own()[0]).toMatchObject({ archived: true, updatedAt: later.toISOString(), updatedBy: 'traeger' })
  })

  it('maps domain errors: unknown section or item 404, everything else 400', () => {
    const status = (code: string) => {
      try {
        withFormErrors(() => { throw new FormError(code) })
      }
      catch (error) {
        return [(error as ServiceError).statusCode, (error as ServiceError).code]
      }
    }
    expect(status('form_section_not_found')).toEqual([404, 'form_section_not_found'])
    expect(status('form_item_not_found')).toEqual([404, 'form_item_not_found'])
    expect(status('form_section_full')).toEqual([400, 'form_section_full'])
  })

  it('another facility\'s template is 404', () => {
    const other = createFacility(db, 'Krippe').id
    const id = create('Probezeit', 'staff', other)
    expect(errorCode(() => updateTemplate(db, leitung, 1, id, { name: 'x' }, now))).toBe('form_template_not_found')
    expect(errorCode(() => deleteTemplate(db, 1, id))).toBe('form_template_not_found')
    expect(errorCode(() => copyTemplate(db, leitung, 1, id, now))).toBe('form_template_not_found')
  })

  it('deletes a template unless forms were made from it', () => {
    const id = create('Probezeit')
    const used = create('Jahresgespräch')
    addForm(used)
    expect(own().find(template => template.id === used)!.inUse).toBe(true)
    expect(errorCode(() => deleteTemplate(db, 1, used))).toBe('form_template_in_use')
    deleteTemplate(db, 1, id)
    expect(own().map(template => template.name)).toEqual(['Jahresgespräch'])
  })

  it('copies with „(Kopie)“, fresh ids and no starter key', () => {
    const [self] = listTemplates(db, 1, 'staff')
    const copy = copyTemplate(db, leitung, 1, self!.id, now)
    const second = copyTemplate(db, leitung, 1, self!.id, now)
    const list = listTemplates(db, 1, 'staff')
    const first = list.find(template => template.id === copy)!
    expect(first).toMatchObject({ name: 'Selbstbeurteilung (Kopie)', starterKey: null, selfAssessment: true, archived: false })
    expect(list.find(template => template.id === second)!.name).toBe('Selbstbeurteilung (Kopie 2)')
    expect(allIds(first.content)).toHaveLength(allIds(self!.content).length)
    expect(allIds(first.content).some(value => allIds(self!.content).includes(value))).toBe(false)
    expect(first.content.sections.map(section => section.title)).toEqual(self!.content.sections.map(section => section.title))

    // A table's columns and fixed rows get fresh ids too; everything else is copied as it is.
    const tableId = create('Gesundheitscheck')
    updateTemplate(db, leitung, 1, tableId, {
      content: {
        sections: [{
          title: 'Gesundheit', items: [
            { kind: 'table', question: 'Impfungen', freeRows: false, columns: [{ heading: 'Bemerkung', type: 'text' }, { heading: 'am', type: 'date' }], rows: [{ label: 'Masern' }] },
            { kind: 'table', question: '', freeRows: true, columns: [{ heading: 'Was', type: 'text' }], rows: [] },
            { kind: 'checkbox', label: 'Impfpass gesehen' },
            { kind: 'choices', question: 'Essen', single: true, options: [{ label: 'ja' }, { label: 'nein' }] },
          ],
        }],
      },
    }, now)
    const original = own().find(template => template.id === tableId)!.content
    const tableCopyId = copyTemplate(db, leitung, 1, tableId, now)
    const tableCopy = listTemplates(db, 1).find(template => template.id === tableCopyId)!.content
    const tableIds = (content: FormContent) => content.sections.flatMap(section => section.items.flatMap(item => (item.kind === 'table'
      ? [item.id, ...item.columns.map(column => column.id), ...item.rows.map(row => row.id)]
      : [item.id])))
    expect(tableIds(tableCopy)).toHaveLength(tableIds(original).length)
    expect(new Set([...tableIds(tableCopy), ...tableIds(original)]).size).toBe(tableIds(original).length * 2)
    const withoutIds = (content: FormContent) => JSON.parse(JSON.stringify(content, (key, value) => (key === 'id' ? undefined : value)))
    expect(withoutIds(tableCopy)).toEqual(withoutIds(original))
    expect(checkContent(tableCopy)).toEqual(tableCopy)

    const long = create('y'.repeat(80))
    const longCopy = copyTemplate(db, leitung, 1, long, now)
    expect(listTemplates(db, 1).find(template => template.id === longCopy)!.name).toBe(`${'y'.repeat(72)} (Kopie)`)
  })
})

describe('form template order (▲/▼ within a category)', () => {
  let facility: number
  let team: number
  let accidents: number
  beforeEach(() => {
    // Only the accident starters (in „Unfälle“): the other example categories start empty.
    facility = createFacility(db, 'Krippe').id
    team = exampleCategoryOf(db, facility, 'team')!
    accidents = exampleCategoryOf(db, facility, 'accident')!
  })
  const names = (categoryId: number | null, archived = false) => listTemplates(db, facility)
    .filter(template => template.archived === archived && (template.subcategoryId ?? template.categoryId) === categoryId).map(template => template.name)
  const idsOf = (...wanted: string[]) => wanted.map(name => listTemplates(db, facility).find(template => template.name === name)!.id)
  const createIn = (name: string, kind: 'staff' | 'child' | 'team', categoryId: number | null) =>
    createTemplate(db, leitung, facility, { kind, name, selfAssessment: false, categoryId }, now)
  /** ▲/▼ on „Vorlagen“ by the Leitung, here for Bögen only (the lists hold no PDF templates). */
  const orderTemplates = (_db: Db, facilityId: number, categoryId: number | null, ids: readonly number[]) =>
    orderEntries(db, { ...leitung, facilityId }, categoryId, ids.map(id => ({ type: 'form' as const, id })))

  it('stores the new order of the active templates of a category; the pickers list them in it', () => {
    for (const name of ['Erste', 'Zweite', 'Dritte']) createIn(name, 'team', team)
    createIn('Kind', 'child', team)
    orderTemplates(db, facility, team, idsOf('Dritte', 'Kind', 'Erste', 'Zweite'))
    expect(names(team)).toEqual(['Dritte', 'Kind', 'Erste', 'Zweite'])
    // The picker still filters by kind, in the category's order.
    const member = { facilityId: facility, role: 'admin' as const, name: 'Leitung', manager: true, left: false, employeeId: null }
    expect(listTeamMeetings(db, member, { year: 2026 }, now).templates).toEqual([
      { id: idsOf('Dritte')[0], name: 'Dritte', category: 'Team' }, { id: idsOf('Erste')[0], name: 'Erste', category: 'Team' },
      { id: idsOf('Zweite')[0], name: 'Zweite', category: 'Team' },
    ])
    // A new template goes to the end of its category.
    createIn('Vierte', 'team', team)
    expect(names(team)).toEqual(['Dritte', 'Kind', 'Erste', 'Zweite', 'Vierte'])
  })

  it('orders the accident templates of both subjects together, as one list', () => {
    const before = names(accidents)
    expect(before).toHaveLength(2)
    const reversed = [...before].reverse()
    orderTemplates(db, facility, accidents, idsOf(...reversed))
    expect(names(accidents)).toEqual(reversed)
  })

  it('keeps archived templates in their place among the others, without ordering them', () => {
    for (const name of ['A', 'B', 'C']) createIn(name, 'team', team)
    const [b] = idsOf('B')
    updateTemplate(db, leitung, facility, b!, { archived: true }, now)
    expect(errorCode(() => orderTemplates(db, facility, team, idsOf('C', 'B', 'A')))).toBe('invalid_order')
    orderTemplates(db, facility, team, idsOf('C', 'A'))
    expect(names(team)).toEqual(['C', 'A'])
    expect(names(team, true)).toEqual(['B'])
    updateTemplate(db, leitung, facility, b!, { archived: false }, now)
    expect(names(team)).toEqual(['C', 'B', 'A'])
  })

  it('orders the templates without a category as their own list, and moves a template to the end of another category', () => {
    const [x, y] = ['X', 'Y'].map(name => createIn(name, 'team', null))
    orderTemplates(db, facility, null, [y!, x!])
    expect(names(null)).toEqual(['Y', 'X'])
    createIn('T', 'team', team)
    updateTemplate(db, leitung, facility, y!, { categoryId: team }, now)
    expect(names(team)).toEqual(['T', 'Y'])
    expect(listTemplates(db, facility).find(template => template.id === y)).toMatchObject({ categoryId: team, subcategoryId: null, category: 'Team' })
  })

  it('refuses an order that is not exactly the active templates of the category in the facility, each once', () => {
    const [a, b] = ['A', 'B'].map(name => createIn(name, 'team', team))
    const elsewhere = createIn('Woanders', 'child', null)
    const foreign = create('Fremd', 'team', 1)
    for (const ids of [[a!], [a!, b!, b!], [a!, b!, elsewhere], [a!, b!, foreign], [b!, foreign]]) {
      expect(errorCode(() => orderTemplates(db, facility, team, ids)), JSON.stringify(ids)).toBe('invalid_order')
    }
    // Another facility's category is no list of this one.
    expect(errorCode(() => orderTemplates(db, facility, exampleCategoryOf(db, 1, 'team')!, [a!, b!]))).toBe('template_category_not_found')
    expect(names(team)).toEqual(['A', 'B'])
  })
})
