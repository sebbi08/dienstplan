import { todayIso } from '../../../../shared/domain/dates'
import { monthParams, printViewQuery } from '../../../schemas'
import { eventAudienceFor } from '../../../services/calendar'
import { getMonthPlan } from '../../../services/plan'

export default defineServiceHandler(async (event) => {
  // Everyone with the released plan, and the facility's tablet; the service shows the draft only with plan.edit. At the
  // tablet while a person edits the plan there („Dienstplan bearbeiten“): as that person's account (planReader).
  const user = await planReader(event, await requirePermission(event, 'plan.view', { allowTerminal: true }))
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  // The print view (`?print=1`, also the PDF) shows only appointments for „Alle“ unless one who sees all asks for more.
  const view = await getValidatedQuery(event, printViewQuery.parse)
  const db = useDb()
  return getMonthPlan(db, user, user.facilityId, year, month, todayIso(), eventAudienceFor(db, user, view))
})
