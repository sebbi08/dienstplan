import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { IsoDate } from '#shared/domain/types'
import type { RequiredDocumentTypeDto, RequiredInspectionInput } from '#shared/types/api'

/**
 * „Einsicht vermerken“ as typed: the certificate's date, the optional day of inspection ('' = none) and the result –
 * „keine einschlägige Eintragung“ ('none') or „einschlägige Eintragung vorhanden“ ('entry'), null until one is chosen.
 * Nothing is preset, also not on „Neu vermerken“: the result is confirmed actively every time.
 */
export interface InspectionForm {
  certificateDate: string
  inspectedOn: string
  choice: 'none' | 'entry' | null
}

/** A fresh form: the certificate's date and day of inspection as given (a record's, or empty / today), no result. */
export const inspectionForm = (certificateDate: string, inspectedOn: string): InspectionForm => ({ certificateDate, inspectedOn, choice: null })

/**
 * What is sent once the form is complete – a certificate's date not after today, a day of inspection (if any) not after
 * today and not before it, and a result chosen – else null (saving stays disabled).
 */
export function inspectionInput(form: InspectionForm, today: IsoDate): RequiredInspectionInput | null {
  if (form.choice === null || form.certificateDate === '' || form.certificateDate > today) return null
  if (form.inspectedOn !== '' && (form.inspectedOn > today || form.inspectedOn < form.certificateDate)) return null
  return { certificateDate: form.certificateDate, inspectedOn: form.inspectedOn || null, noRelevantEntry: form.choice === 'none' }
}

/**
 * Whether a signed copy can be filed as the type: an active type of the folder that keeps a file – never one „nur
 * Einsicht vermerken“ (the Führungszeugnis, § 72a Abs. 5 SGB VIII; the server refuses it too).
 */
export const filesSignedCopy = (type: RequiredDocumentTypeDto, folder: EmployeeDocumentFolder): boolean =>
  type.active && type.folder === folder && type.mode === 'file'

/**
 * „Als Pflichtdokument ablegen“ in „Zum Unterschreiben senden“: the chosen type stays while it can take the signed copy
 * in the chosen folder (filesSignedCopy), else none (0). Only once the types are loaded – before that the preset from the
 * box is kept.
 */
export function keptRequiredType(
  types: readonly RequiredDocumentTypeDto[] | null, folder: EmployeeDocumentFolder, typeId: number,
): number {
  if (types === null) return typeId
  return types.some(type => type.id === typeId && filesSignedCopy(type, folder)) ? typeId : 0
}
