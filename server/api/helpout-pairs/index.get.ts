import { listHelpoutPairs } from '../../services/helpoutPairs'

/**
 * The pairs of facilities allowed to help each other out (Einstellungen → Einrichtung): the Träger every pair and the
 * facilities with help-outs but no pair, the Leitung the pairs of her own facility (read-only).
 */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'settings.facility')
  return listHelpoutPairs(useDb(), viewer)
})
