import { documentResponseHeaders } from '../../../lib/documentHttp'
import { fileQuery, idParams } from '../../../schemas'
import { readEmployeeAccidentAttachment } from '../../../services/accidents'

/** An attachment of an employee's accident report, for whoever reads the report (never the tablet). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const query = await getValidatedQuery(event, fileQuery.parse)
  const file = readEmployeeAccidentAttachment(useDb(), accidentActor(event, user), id)
  setResponseHeaders(event, documentResponseHeaders(file, query.download === '1'))
  return file.data
})
