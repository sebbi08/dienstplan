import { getRights } from '../services/rights'

/** The rights page (Träger only): every switch with its relations, the Träger-only rights, the roles' settings. */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'rights.manage', { facility: 'none' })
  return getRights(useDb())
})
