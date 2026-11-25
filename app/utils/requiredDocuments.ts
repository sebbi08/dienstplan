import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { RequiredDocumentTypeDto } from '#shared/types/api'

/**
 * „Als Pflichtdokument ablegen“ in „Zum Unterschreiben senden“: the chosen type stays while it is an active type of the
 * chosen folder, else none (0). Only once the types are loaded – before that the preset from the box is kept.
 */
export function keptRequiredType(
  types: readonly RequiredDocumentTypeDto[] | null, folder: EmployeeDocumentFolder, typeId: number,
): number {
  if (types === null) return typeId
  return types.some(type => type.id === typeId && type.active && type.folder === folder) ? typeId : 0
}
