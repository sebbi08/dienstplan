import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { printTemplates } from '../../server/db/schema'
import { MAX_DOCUMENT_BYTES } from '../../server/lib/fileSignature'
import {
  deleteTemplate, listTemplates, readTemplateFile, replaceTemplateFile, templateReaderFacility, updateTemplate, uploadTemplate,
  type TemplateActor,
} from '../../server/services/printTemplates'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const NOW = new Date('2026-10-21T08:30:00.000Z')
const LATER = new Date('2026-10-22T09:00:00.000Z')

const pdf = (extra = 'content') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(extra)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png')])

const actor = (user: SessionUser): TemplateActor => ({ id: user.id, role: user.role, facilityId: user.facilityId! })

describe('print templates', () => {
  let db: Db
  let other: number
  let leitung: TemplateActor
  let otherLeitung: TemplateActor
  let provider: TemplateActor

  beforeEach(() => {
    db = createTestDb()
    other = addFacility(db, 'Krippe')
    leitung = actor(addUser(db, 'leitung', 'admin'))
    otherLeitung = actor(addUser(db, 'leitung2', 'admin', null, other))
    provider = actor(addUser(db, 'traeger', 'provider'))
  })

  const upload = (
    by: TemplateActor, fields: Partial<{ title: string; category: string; scope: 'facility' | 'all' }> = {},
    data: Buffer = pdf(), filename = 'Elternbrief.pdf',
  ) => uploadTemplate(db, by, { title: 'Elternbrief', category: 'Eltern', scope: 'facility', ...fields }, { data, filename }, NOW)
  const titles = (facilityId: number, role: SessionUser['role'] = 'admin') =>
    listTemplates(db, { role, facilityId }).map(template => template.title)

  describe('upload', () => {
    it('stores a PDF for the own facility with its title, category, size and upload time', () => {
      const id = upload(leitung, { title: '  Elternbrief  ', category: ' Eltern ' })
      expect(listTemplates(db, { role: 'admin', facilityId: 1 })).toEqual([{
        id, title: 'Elternbrief', category: 'Eltern', global: false, size: pdf().length,
        uploadedAt: NOW.toISOString(), updatedAt: NOW.toISOString(), canEdit: true,
      }])
      const row = db.select().from(printTemplates).get()!
      expect(row).toMatchObject({ facilityId: 1, mimeType: 'application/pdf', uploadedBy: leitung.id })
      expect(row.data.equals(pdf())).toBe(true)
    })

    it('files an empty category under „Sonstiges“ and takes the file name for an empty title', () => {
      upload(leitung, { title: ' ', category: '  ' }, pdf(), 'Anmeldung Ausflug.pdf')
      expect(listTemplates(db, { role: 'admin', facilityId: 1 })[0]).toMatchObject({ title: 'Anmeldung Ausflug', category: 'Sonstiges' })
    })

    it('accepts PDF files only, judged by the first bytes', () => {
      expect(errorCode(() => upload(leitung, {}, png(), 'brief.pdf'))).toBe('print_template_type_invalid')
      expect(errorCode(() => upload(leitung, {}, Buffer.from('Hallo'), 'brief.pdf'))).toBe('print_template_type_invalid')
      expect(db.select().from(printTemplates).all()).toEqual([])
    })

    it('refuses files larger than the document limit', () => {
      const big = Buffer.concat([pdf(), Buffer.alloc(MAX_DOCUMENT_BYTES)])
      expect(errorCode(() => upload(leitung, {}, big))).toBe('document_too_large')
      expect(upload(leitung, {}, Buffer.concat([pdf(''), Buffer.alloc(MAX_DOCUMENT_BYTES - pdf('').length)]))).toBeGreaterThan(0)
    })

    it('lets the Leitung upload for its own facility only', () => {
      expect(errorCode(() => upload(leitung, { scope: 'all' }))).toBe('forbidden')
      upload(otherLeitung, { title: 'Krippenbrief' })
      expect(db.select({ facilityId: printTemplates.facilityId }).from(printTemplates).all()).toEqual([{ facilityId: other }])
    })

    it('lets the Träger upload for all facilities or for the facility they work in', () => {
      upload(provider, { title: 'Für alle', scope: 'all' })
      upload(provider, { title: 'Nur hier', scope: 'facility' })
      expect(db.select({ title: printTemplates.title, facilityId: printTemplates.facilityId }).from(printTemplates).all())
        .toEqual([{ title: 'Für alle', facilityId: null }, { title: 'Nur hier', facilityId: 1 }])
    })
  })

  describe('list', () => {
    it('shows the own and the global templates, never those of another facility, grouped by category', () => {
      upload(leitung, { title: 'Zahnarzt', category: 'Gesundheit' })
      upload(leitung, { title: 'Ausflug', category: 'Eltern' })
      upload(otherLeitung, { title: 'Krippenbrief', category: 'Eltern' })
      upload(provider, { title: 'Urlaubsantrag', category: 'Personal', scope: 'all' })
      upload(leitung, { title: 'Allergien', category: 'Gesundheit' })
      expect(listTemplates(db, { role: 'admin', facilityId: 1 }).map(template => [template.category, template.title, template.global]))
        .toEqual([
          ['Eltern', 'Ausflug', false], ['Gesundheit', 'Allergien', false], ['Gesundheit', 'Zahnarzt', false],
          ['Personal', 'Urlaubsantrag', true],
        ])
      expect(titles(other)).toEqual(['Krippenbrief', 'Urlaubsantrag'])
    })

    it('marks as editable what the viewer may change: the Leitung not the global ones, the tablet nothing', () => {
      upload(leitung, { title: 'Eigene' })
      upload(provider, { title: 'Global', scope: 'all' })
      const editable = (role: SessionUser['role']) =>
        listTemplates(db, { role, facilityId: 1 }).map(template => [template.title, template.canEdit])
      expect(editable('admin')).toEqual([['Eigene', true], ['Global', false]])
      expect(editable('provider')).toEqual([['Eigene', true], ['Global', true]])
      expect(editable('terminal')).toEqual([['Eigene', false], ['Global', false]])
    })
  })

  describe('who may read', () => {
    it('lets Leitung, Träger and the tablet in with their facility', () => {
      expect(templateReaderFacility(addUser(db, 'l3', 'admin', null, other))).toBe(other)
      expect(templateReaderFacility(addUser(db, 't1', 'provider'))).toBe(1)
      expect(templateReaderFacility(addUser(db, 'tablet', 'terminal'))).toBe(1)
    })

    it('keeps Mitarbeiter accounts out (also with a facility through their employee)', () => {
      const staff = addUser(db, 'anna', 'observer', addEmployee(db, 'Anna'))
      expect(staff.facilityId).toBe(1)
      expect(errorCode(() => templateReaderFacility(staff))).toBe('forbidden')
    })

    it('refuses an account without a facility', () => {
      const tablet = { ...addUser(db, 'tablet2', 'terminal'), facilityId: null }
      expect(errorCode(() => templateReaderFacility(tablet))).toBe('no_facility')
    })
  })

  describe('file', () => {
    it('serves the own and the global templates as PDF named after the title', () => {
      const own = upload(leitung, { title: 'Einverständnis Ausflug' })
      const global = upload(provider, { title: 'Urlaubsantrag Ü', scope: 'all' })
      expect(readTemplateFile(db, 1, own)).toEqual({ data: pdf(), mimeType: 'application/pdf', fileName: 'Einverstaendnis-Ausflug.pdf' })
      expect(readTemplateFile(db, other, global).fileName).toBe('Urlaubsantrag-Ue.pdf')
    })

    it('hides the templates of another facility', () => {
      const id = upload(otherLeitung)
      expect(errorCode(() => readTemplateFile(db, 1, id))).toBe('print_template_not_found')
      expect(errorCode(() => readTemplateFile(db, 1, 999))).toBe('print_template_not_found')
    })
  })

  describe('change', () => {
    it('renames and moves to another category', () => {
      const id = upload(leitung)
      updateTemplate(db, leitung, id, { title: ' Elternbrief Herbst ', category: '' }, LATER)
      expect(listTemplates(db, { role: 'admin', facilityId: 1 })[0]).toMatchObject({
        id, title: 'Elternbrief Herbst', category: 'Sonstiges', uploadedAt: NOW.toISOString(), updatedAt: LATER.toISOString(),
      })
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: '  ', category: 'Eltern' }))).toBe('print_template_title_required')
    })

    it('replaces the file and keeps the id', () => {
      const id = upload(leitung)
      replaceTemplateFile(db, leitung, id, { data: pdf('version 2'), filename: 'neu.pdf' }, LATER)
      expect(listTemplates(db, { role: 'admin', facilityId: 1 }).map(template => [template.id, template.size, template.updatedAt]))
        .toEqual([[id, pdf('version 2').length, LATER.toISOString()]])
      expect(readTemplateFile(db, 1, id).data.equals(pdf('version 2'))).toBe(true)
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: png(), filename: 'x.pdf' }))).toBe('print_template_type_invalid')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, {
        data: Buffer.concat([pdf(), Buffer.alloc(MAX_DOCUMENT_BYTES)]), filename: 'x.pdf',
      }))).toBe('document_too_large')
    })

    it('deletes the template', () => {
      const id = upload(leitung)
      const kept = upload(leitung, { title: 'Bleibt' })
      deleteTemplate(db, leitung, id)
      expect(titles(1)).toEqual(['Bleibt'])
      expect(errorCode(() => readTemplateFile(db, 1, id))).toBe('print_template_not_found')
      expect(readTemplateFile(db, 1, kept).data.length).toBeGreaterThan(0)
    })

    it('keeps the Träger\'s global templates away from the Leitung (403), but lets the Träger change them', () => {
      const id = upload(provider, { scope: 'all' })
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', category: 'Eltern' }))).toBe('forbidden')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: pdf('x'), filename: 'x.pdf' }))).toBe('forbidden')
      expect(errorCode(() => deleteTemplate(db, leitung, id))).toBe('forbidden')
      updateTemplate(db, provider, id, { title: 'Neu', category: 'Personal' })
      deleteTemplate(db, provider, id)
      expect(titles(1)).toEqual([])
    })

    it('treats the template of another facility as missing', () => {
      const id = upload(otherLeitung)
      expect(errorCode(() => updateTemplate(db, leitung, id, { title: 'X', category: '' }))).toBe('print_template_not_found')
      expect(errorCode(() => replaceTemplateFile(db, leitung, id, { data: pdf(), filename: 'x.pdf' }))).toBe('print_template_not_found')
      expect(errorCode(() => deleteTemplate(db, leitung, id))).toBe('print_template_not_found')
      expect(titles(other)).toEqual(['Elternbrief'])
    })
  })
})
