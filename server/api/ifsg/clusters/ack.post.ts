import { ifsgClusterAckSchema } from '../../../schemas'
import { acknowledgeIfsgCluster } from '../../../services/ifsg'

/** A cluster of a disease (§ 34 Abs. 6 Satz 2) was reported to the health office on that day (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { disease, acknowledgedOn } = await readValidatedBody(event, ifsgClusterAckSchema.parse)
  acknowledgeIfsgCluster(useDb(), manager, disease, acknowledgedOn)
  return { ok: true }
})
