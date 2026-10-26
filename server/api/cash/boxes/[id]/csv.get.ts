import { todayIso } from '../../../../../shared/domain/dates'
import { csvResponseHeaders } from '../../../../lib/documentHttp'
import { cashCsvQuery, idParams } from '../../../../schemas'
import { boxCsv } from '../../../../services/cashClosing'

/** The CSV file (for Excel) of a month or, without `month`, of the calendar year of a box of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { year, month } = await getValidatedQuery(event, cashCsvQuery.parse)
  const file = boxCsv(useDb(), admin.facilityId, id, year, month ?? null, todayIso())
  setResponseHeaders(event, csvResponseHeaders(file.filename))
  return file.body
})
