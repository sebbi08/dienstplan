import { listConsentQuestions } from '../../services/childConsents'

/** The facility's consent questions for the settings (with the number of answers); the record brings its own. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return listConsentQuestions(useDb(), admin.facilityId)
})
