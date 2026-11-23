import { can } from '../../../shared/domain/permissions'
import { targetOptions } from '../../services/documentTargets'

/** What „Gilt für“ offers whoever uploads templates: the Träger every facility with its groups, else the own facility. */
export default defineServiceHandler(async (event) => {
  const editor = await requirePermission(event, 'printTemplates.edit')
  return targetOptions(useDb(), editor.facilityId, can(editor.permissions, 'printTemplates.global'))
})
