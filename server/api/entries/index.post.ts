import type { ApplyEntriesResultDto } from '../../../shared/types/api'
import { applyEntriesSchema } from '../../schemas'
import { applyToCells } from '../../services/entries'

/** Writes into the selected plan cells; says whether „Krank melden“ left days alone that were already „abwesend“. */
export default defineServiceHandler(async (event): Promise<ApplyEntriesResultDto & { ok: true }> => {
  const admin = await requirePermission(event, 'plan.edit', { tabletPlanEdit: true })
  const body = await readValidatedBody(event, applyEntriesSchema.parse)
  return { ok: true, ...applyToCells(useDb(), admin, admin.facilityId, body.cells, body.mode, body.entry) }
})
