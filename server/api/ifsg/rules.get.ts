import { ifsgRules } from '../../services/ifsg'

/** The facility's § 34 IfSG rules for the dialogs (diseases, kinds, readmission, date rules) and the attest setting. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  return ifsgRules(useDb(), viewer)
})
