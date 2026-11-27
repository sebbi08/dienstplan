import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { RequiredDocumentTypeDto } from '#shared/types/api'

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
