import { getIfsgSettings } from '../../services/ifsg'

/** The facility's § 34 IfSG setting („Schriftliches Attest verlangen“), for Leitung and Träger. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return getIfsgSettings(useDb(), admin.facilityId)
})
