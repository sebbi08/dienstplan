import { PAGE_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import { assertPageFacility } from '../lib/pageFacility'
import { listFacilities } from '../services/facilities'

/**
 * The facility name in the header and the Träger's facility switcher: for every signed-in account (the own facility;
 * the Träger all of them), never the tablet. The active facility, also while the Träger edits another one's settings;
 * a stale Träger page gets 409 facility_changed.
 */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  assertPageFacility(user, getHeader(event, PAGE_FACILITY_HEADER))
  return listFacilities(useDb(), user)
})
