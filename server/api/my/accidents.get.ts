import { listMyAccidents } from '../../services/accidents'

/** „Meine Unfälle“: the accident reports about the signed-in employee (404 without a linked employee, tablet 403). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return listMyAccidents(useDb(), accidentActor(event, user))
})
