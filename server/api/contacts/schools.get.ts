import { schoolOptions, withProviderSchools } from '../../services/contacts'

/**
 * The schools to choose as a child's „künftige Schule“ (names only): for whoever edits child records, at the office or
 * the unlocked tablet, in the facility of the records; those for the Träger alone only for the Träger.
 */
export default defineServiceHandler(async (event) => {
  const editor = await requireChildPermission(event, 'children.edit')
  return schoolOptions(useDb(), editor.facilityId, withProviderSchools(editor))
})
