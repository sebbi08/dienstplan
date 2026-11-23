import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION, type EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { PermissionKey } from '#shared/domain/permissions'
import type { IsoDate } from '#shared/domain/types'
import type { ChildDocumentMeta, DocumentTypeDto, EmployeeDocumentMeta } from '#shared/types/api'
import { formatDate } from '~/utils/format'

/**
 * „Ausfüllen“ of PDFs in the app (Dokumente → Vorlagen, child record, personnel file): who the filled copy can go to
 * and the requests that save it. The fill view itself (pdf.js) is app/components/pdf/FillDialog.vue.
 */

/** A child's record or a person's personnel file. */
export type FillKind = 'child' | 'employee'

/** Whom a form is filled for. */
export interface FillTarget {
  kind: FillKind
  id: number
  name: string
}

/** The PDF the fill view opens: a template, or a document saved before („Bearbeiten“). */
export interface FillSource {
  url: string
  title: string
}

/**
 * Where the filled copy goes: a new document in the child's record or in a folder of the personnel file (the upload
 * routes, with their rights), or in place of the document it was opened from.
 */
export type FillSave =
  | { mode: 'new-child'; childId: number; meta: ChildDocumentMeta }
  | { mode: 'new-employee'; employeeId: number; meta: EmployeeDocumentMeta }
  | { mode: 'replace'; kind: FillKind; documentId: number }

/** The request that saves the filled PDF (multipart, the file as „file“). */
export function fillSaveRequest(save: FillSave, file: Blob): { url: string; method: 'POST' | 'PUT'; body: FormData } {
  const body = new FormData()
  body.append('file', file, 'Formular.pdf')
  if (save.mode === 'new-child') {
    body.append('typeId', String(save.meta.typeId))
    body.append('title', save.meta.title)
    body.append('documentDate', save.meta.documentDate)
    body.append('confidential', String(save.meta.confidential))
    return { url: `/api/children/${save.childId}/documents`, method: 'POST', body }
  }
  if (save.mode === 'new-employee') {
    body.append('folder', save.meta.folder)
    body.append('title', save.meta.title)
    body.append('documentDate', save.meta.documentDate)
    body.append('note', save.meta.note)
    return { url: `/api/employees/${save.employeeId}/documents`, method: 'POST', body }
  }
  const base = save.kind === 'child' ? '/api/child-documents' : '/api/employee-documents'
  return { url: `${base}/${save.documentId}/file`, method: 'PUT', body }
}

/** The title a new filled copy starts with: the template's title and the day („Einverständnis 20.11.2026“). */
export const fillTitle = (templateTitle: string, day: IsoDate): string => `${templateTitle.trim()} ${formatDate(day)}`.trim().slice(0, 200)

const fold = (text: string) => text.trim().toLocaleLowerCase('de').replace(/ß/g, 'ss')

/**
 * The document type a filled copy starts with: the type named like the template, else the longest type name the
 * template's title contains, else „Sonstiges“, else the first type.
 */
export function defaultDocumentType(types: readonly DocumentTypeDto[], templateTitle: string): DocumentTypeDto | undefined {
  const title = fold(templateTitle)
  const named = types.find(type => fold(type.name) === title)
    ?? types.filter(type => fold(type.name) !== '' && title.includes(fold(type.name)))
      .sort((a, b) => b.name.length - a.name.length)[0]
  return named ?? types.find(type => fold(type.name) === 'sonstiges') ?? types[0]
}

/** The folders of the personnel file the viewer may put documents into (their keys). */
export const usableFolders = (can: (key: PermissionKey) => boolean): EmployeeDocumentFolder[] =>
  EMPLOYEE_DOCUMENT_FOLDERS.filter(folder => can(FOLDER_PERMISSION[folder]))

/**
 * For whom the viewer may fill a form: a child where they may upload child documents (an office account with its own
 * child access and „eintragen und Akten ändern“, or the tablet unlocked by such a person), a person of the team where
 * they see personnel files and may use a folder (never at the tablet). The server checks every save again.
 */
export function fillKinds(input: { onTablet: boolean; tabletMayEdit: boolean; can: (key: PermissionKey) => boolean }): FillKind[] {
  const kinds: FillKind[] = []
  const child = input.onTablet ? input.tabletMayEdit : input.can('children.ownAccount') && input.can('children.edit')
  if (child) kinds.push('child')
  if (!input.onTablet && input.can('employees.view') && usableFolders(input.can).length > 0) kinds.push('employee')
  return kinds
}

/** The entries of a target list matching the search (every word somewhere in the name or the note), at most `limit`. */
export function searchTargets<T extends { name: string; note?: string | null }>(items: readonly T[], query: string, limit = 50): T[] {
  const words = fold(query).split(/\s+/).filter(word => word !== '')
  return items.filter((item) => {
    const text = fold(`${item.name} ${item.note ?? ''}`)
    return words.every(word => text.includes(word))
  }).slice(0, limit)
}
