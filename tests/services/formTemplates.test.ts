import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { forms, formStarterSeeds, formTemplates } from '../../server/db/schema'
import { seedDefaults } from '../../server/db/seed'
import { createFacility } from '../../server/services/facilities'
import {
  copyTemplate, createTemplate, deleteTemplate, listTemplates, seedPendingStarterTemplates, updateTemplate, withFormErrors,
} from '../../server/services/formTemplates'
import type { ServiceError } from '../../server/lib/errors'
import { checkContent, FormError, type FormContent } from '../../shared/domain/forms'
import { CHILD_STARTERS, RATING_LEGEND, STAFF_STARTERS, starterContent, TEAM_STARTERS } from '../../shared/domain/forms/starters'
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
  .where(eq(formStarterSeeds.facilityId, facilityId)).all().map(row => row.key).sort()
const own = (facilityId = 1) => listTemplates(db, facilityId).filter(template => template.starterKey === null)
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

  it('the Teamsitzung has five sections, each one free text asking the section title', () => {
    let next = 0
    const content = checkContent(starterContent(TEAM_STARTERS[0]!, () => `id${next++}`))
    expect(TEAM_STARTERS.map(starter => [starter.key, starter.kind, starter.name])).toEqual([['team_meeting', 'team', 'Teamsitzung']])
    const titles = ['Tagesordnung', 'Themen und Ergebnisse', 'Vereinbarungen und Aufgaben (wer, was, bis wann)', 'Termine', 'Sonstiges']
    expect(content.sections.map(section => section.title)).toEqual(titles)
    expect(content.sections.map(section => section.items.map(item => item.kind === 'text' && item.question)))
      .toEqual(titles.map(title => [title]))
  })

  it('a facility seeded before the team meetings gets only the Teamsitzung added, once', () => {
    const old = createFacility(db, 'Alt').id
    db.delete(formTemplates).where(and(eq(formTemplates.facilityId, old), eq(formTemplates.kind, 'team'))).run()
    db.delete(formStarterSeeds).where(and(eq(formStarterSeeds.facilityId, old), eq(formStarterSeeds.starterKey, 'team_meeting'))).run()

    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old, 'team').map(template => [template.name, template.starterKey])).toEqual([['Teamsitzung', 'team_meeting']])
    expect(listTemplates(db, old)).toHaveLength(4)
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
  })

  it('a new facility gets all four starters, with fresh ids each, and records each key as given', () => {
    const id = createFacility(db, 'Krippe').id
    const list = listTemplates(db, id)
    expect(list.map(template => [template.name, template.kind, template.starterKey, template.selfAssessment])).toEqual([
      ['Selbstbeurteilung', 'staff', 'staff_self_assessment', true],
      ['Beurteilungsbogen pädagogische Fachkräfte', 'staff', 'staff_assessment', false],
      ['Entwicklungsgespräch', 'child', 'child_development', false],
      ['Teamsitzung', 'team', 'team_meeting', false],
    ])
    expect(new Set(allIds(list[0]!.content)).size).toBe(allIds(list[0]!.content).length)
    expect(allIds(listTemplates(db, 1, 'staff')[0]!.content)).not.toEqual(allIds(list[0]!.content))
    expect(seeds(id)).toEqual(['child_development', 'staff_assessment', 'staff_self_assessment', 'team_meeting'])
  })

  it('a facility seeded with the staff starters only gets the child starter added, once', () => {
    const old = createFacility(db, 'Alt').id
    // As 0056 leaves a facility that had the staff starters: the child starter is neither there nor recorded.
    db.delete(formTemplates).where(and(eq(formTemplates.facilityId, old), eq(formTemplates.kind, 'child'))).run()
    db.delete(formStarterSeeds).where(and(eq(formStarterSeeds.facilityId, old), eq(formStarterSeeds.starterKey, 'child_development'))).run()
    const [self] = listTemplates(db, old)
    deleteTemplate(db, old, self!.id)

    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old).map(template => template.starterKey)).toEqual(['staff_assessment', 'child_development', 'team_meeting'])
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
    seedDefaults(db)
    expect(listTemplates(db, old).map(template => template.starterKey)).toEqual(['staff_assessment', 'child_development', 'team_meeting'])
  })

  it('existing facilities are seeded once at startup; renamed or deleted starters are not created again', () => {
    // A facility from before the forms: no templates, nothing recorded.
    const old = createFacility(db, 'Alt').id
    db.delete(formTemplates).where(eq(formTemplates.facilityId, old)).run()
    db.delete(formStarterSeeds).where(eq(formStarterSeeds.facilityId, old)).run()
    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old).map(template => template.starterKey))
      .toEqual(['staff_self_assessment', 'staff_assessment', 'child_development', 'team_meeting'])

    const [self, assessment, child, team] = listTemplates(db, old)
    updateTemplate(db, leitung, old, self!.id, { name: 'Meine Selbstbeurteilung' }, now)
    deleteTemplate(db, old, assessment!.id)
    deleteTemplate(db, old, child!.id)
    deleteTemplate(db, old, team!.id)
    seedDefaults(db)
    expect(seedPendingStarterTemplates(db, now)).toBe(0)
    expect(listTemplates(db, old).map(template => template.name)).toEqual(['Meine Selbstbeurteilung'])
  })

  it('a starter template already there is only recorded, not created twice', () => {
    const old = createFacility(db, 'Alt').id
    db.delete(formStarterSeeds).where(eq(formStarterSeeds.facilityId, old)).run()
    expect(seedPendingStarterTemplates(db, now)).toBe(1)
    expect(listTemplates(db, old)).toHaveLength(4)
    expect(seeds(old)).toHaveLength(4)
  })

  it('facility 1 of a fresh database is seeded by the startup step', () => {
    expect(listTemplates(db, 1, 'staff').map(template => template.starterKey)).toEqual(['staff_self_assessment', 'staff_assessment'])
    expect(listTemplates(db, 1, 'child').map(template => template.starterKey)).toEqual(['child_development'])
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

    const long = create('y'.repeat(80))
    const longCopy = copyTemplate(db, leitung, 1, long, now)
    expect(listTemplates(db, 1).find(template => template.id === longCopy)!.name).toBe(`${'y'.repeat(72)} (Kopie)`)
  })
})
