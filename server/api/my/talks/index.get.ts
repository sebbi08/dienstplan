import { listMyTalks } from '../../../services/staffTalks'

/** The signed-in employee's talks with only the forms released to them (404 without a linked employee, tablet 403). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return listMyTalks(useDb(), user)
})
