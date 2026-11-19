import { ifsgPresetSchema } from '../../../schemas'
import { applyIfsgPreset } from '../../../services/ifsgLocal'

/** „RKI-Werte übernehmen“ or „Vorlage übernehmen: Gesundheitsamt Rhein-Neckar-Kreis“; answers the rows written. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { preset, overwrite } = await readValidatedBody(event, ifsgPresetSchema.parse)
  return { written: applyIfsgPreset(useDb(), admin.facilityId, preset, overwrite) }
})
