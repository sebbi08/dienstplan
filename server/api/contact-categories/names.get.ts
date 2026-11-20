import { globalContactCategoryNames } from '../../services/contacts'

/** The category names the facilities use, to offer the Träger for a contact for all facilities. */
export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'contacts.global', { facility: 'none' })
  return globalContactCategoryNames(useDb(), provider)
})
