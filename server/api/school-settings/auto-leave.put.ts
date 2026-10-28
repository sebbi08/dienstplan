import { todayIso } from '../../../shared/domain/dates'
import { autoLeaveSchema } from '../../schemas'
import { setAutoLeave } from '../../services/schoolChildren'

/**
 * The Träger switches the automatic leaving of school children of the active facility on or off. Switching on takes
 * `confirmed`, the children the preview route showed with their leaving days (`{ id, leftOn }[]`): they are
 * deregistered at once, and 409 auto_leave_preview_changed answers when they are no longer the ones, or no longer the
 * days, it would deregister them to.
 */
export default defineServiceHandler(async (event) => {
  const provider = await requirePermission(event, 'children.schoolSettings')
  const { value, confirmed } = await readValidatedBody(event, autoLeaveSchema.parse)
  const deregistered = setAutoLeave(useDb(), provider.facilityId, value, todayIso(), confirmed)
  // Only the number goes into the log, never a name.
  if (deregistered > 0) console.info(`Deregistered ${deregistered} school child(ren).`)
  return { ok: true, deregistered }
})
