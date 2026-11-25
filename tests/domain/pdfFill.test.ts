import { describe, expect, it } from 'vitest'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { DocumentTypeDto } from '../../shared/types/api'
import { defaultDocumentType, fillKinds, fillSaveRequest, fillTitle, searchTargets, usableFolders } from '../../app/utils/pdfFill'

const type = (id: number, name: string): DocumentTypeDto => ({
  id, name, important: false, required: false, confidentialDefault: false, sortOrder: id, careContract: false,
})
const TYPES = [type(1, 'Betreuungsvertrag'), type(2, 'Ärztliches Attest'), type(3, 'Sonstiges'), type(4, 'Attest')]
const allowing = (...keys: PermissionKey[]) => (key: PermissionKey) => keys.includes(key)

describe('filling PDF forms: helpers of the fill view', () => {
  it('builds the save request for a new child document with type, title, date and confidentiality', async () => {
    const file = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' })
    const request = fillSaveRequest({
      mode: 'new-child', childId: 7, meta: { typeId: 3, title: 'Einverständnis 20.11.2026', documentDate: '2026-11-20', confidential: true },
    }, file)
    expect(request).toMatchObject({ url: '/api/children/7/documents', method: 'POST' })
    expect(Object.fromEntries([...request.body.entries()].filter(([key]) => key !== 'file'))).toEqual({
      typeId: '3', title: 'Einverständnis 20.11.2026', documentDate: '2026-11-20', confidential: 'true',
    })
    const sent = request.body.get('file') as File
    expect(sent.name).toBe('Formular.pdf')
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
  })

  it('builds the save request for a folder of the personnel file and the replacements („Weiter ausfüllen“)', () => {
    const file = new Blob(['%PDF'])
    const request = fillSaveRequest({
      mode: 'new-employee', employeeId: 4, meta: { folder: 'correspondence', title: 'Belehrung', documentDate: '2026-11-20', note: '' },
    }, file)
    expect(request).toMatchObject({ url: '/api/employees/4/documents', method: 'POST' })
    expect(Object.fromEntries([...request.body.entries()].filter(([key]) => key !== 'file'))).toEqual({
      folder: 'correspondence', title: 'Belehrung', documentDate: '2026-11-20', note: '',
    })
    // „Ausfüllen“ of a Pflichtdokument: linked in the same request.
    const linked = fillSaveRequest({
      mode: 'new-employee', employeeId: 4, meta: { folder: 'contract', title: 'Datenschutz', documentDate: '2026-11-20', note: '' }, requiredTypeId: 7,
    }, file)
    expect(linked.body.get('requiredTypeId')).toBe('7')
    expect(request.body.get('requiredTypeId')).toBeNull()
    expect(fillSaveRequest({ mode: 'replace', kind: 'child', documentId: 9 }, file)).toMatchObject({ url: '/api/child-documents/9/file', method: 'PUT' })
    const replace = fillSaveRequest({ mode: 'replace', kind: 'employee', documentId: 5 }, file)
    expect(replace).toMatchObject({ url: '/api/employee-documents/5/file', method: 'PUT' })
    expect([...replace.body.keys()]).toEqual(['file'])
  })

  it('titles a filled copy with the template title and the day', () => {
    expect(fillTitle(' Einverständnis Ausflug ', '2026-11-20')).toBe('Einverständnis Ausflug 20.11.2026')
    expect(fillTitle('x'.repeat(250), '2026-11-20')).toHaveLength(200)
  })

  it('picks the document type named like the template, else the longest name in its title, else „Sonstiges“', () => {
    expect(defaultDocumentType(TYPES, 'attest')?.id).toBe(4)
    expect(defaultDocumentType(TYPES, 'Ärztliches Attest Sport')?.id).toBe(2)
    expect(defaultDocumentType(TYPES, 'Betreuungsvertrag Krippe')?.id).toBe(1)
    expect(defaultDocumentType(TYPES, 'Einverständnis Ausflug')?.id).toBe(3)
    expect(defaultDocumentType([type(5, 'Vertrag')], 'Einverständnis')?.id).toBe(5)
    expect(defaultDocumentType([], 'Einverständnis')).toBeUndefined()
  })

  it('offers a child only where child documents may be uploaded, a person only with personnel files and a folder', () => {
    const office = allowing('children.ownAccount', 'children.edit', 'employees.view', 'employees.docs.correspondence')
    expect(fillKinds({ onTablet: false, tabletMayEdit: false, can: office })).toEqual(['child', 'employee'])
    expect(fillKinds({ onTablet: false, tabletMayEdit: false, can: allowing('children.edit', 'employees.view') })).toEqual([])
    // At the tablet only for a child, and only while a person who may edit has unlocked it.
    expect(fillKinds({ onTablet: true, tabletMayEdit: true, can: office })).toEqual(['child'])
    expect(fillKinds({ onTablet: true, tabletMayEdit: false, can: office })).toEqual([])
    expect(usableFolders(office)).toEqual(['correspondence'])
    // Infogespräche & Hospitationen: with visits.manage, never at the tablet.
    expect(fillKinds({ onTablet: false, tabletMayEdit: false, can: allowing('visits.manage') })).toEqual(['infoVisit', 'applicant'])
    expect(fillKinds({ onTablet: true, tabletMayEdit: false, can: allowing('visits.manage') })).toEqual([])
  })

  it('builds the save requests of a visit\'s document (new and „Bearbeiten“)', () => {
    const file = new Blob(['%PDF'])
    const info = fillSaveRequest({ mode: 'new-visit', kind: 'infoVisit', visitId: 3, title: 'Anmeldung' }, file)
    expect(info).toMatchObject({ url: '/api/info-visits/3/documents', method: 'POST' })
    expect(info.body.get('title')).toBe('Anmeldung')
    expect(fillSaveRequest({ mode: 'new-visit', kind: 'applicant', visitId: 4, title: 'X' }, file)).toMatchObject({ url: '/api/applicant-visits/4/documents' })
    expect(fillSaveRequest({ mode: 'replace', kind: 'applicant', documentId: 8 }, file)).toMatchObject({ url: '/api/visit-documents/8/file', method: 'PUT' })
  })

  it('searches the targets by every word, regardless of case', () => {
    const items = [{ name: 'Lena Kurz', note: 'Bären' }, { name: 'Ben Bär', note: null }, { name: 'Anna Groß', note: 'Füchse' }]
    expect(searchTargets(items, 'bär').map(item => item.name)).toEqual(['Lena Kurz', 'Ben Bär'])
    expect(searchTargets(items, 'lena BÄREN').map(item => item.name)).toEqual(['Lena Kurz'])
    expect(searchTargets(items, 'gross').map(item => item.name)).toEqual(['Anna Groß'])
    expect(searchTargets(items, '  ')).toHaveLength(3)
    expect(searchTargets(items, '', 1)).toHaveLength(1)
  })
})
