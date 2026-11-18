import type { H3Event } from 'h3'
import { can } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import type { AccidentActor } from '../services/accidents'

/**
 * The account as the employee accident routes work with it (after `requireUser`, so never the tablet): with
 * accidents.manage the facility it works in (stale-page checks as everywhere), else none, as only its own reports are
 * open to it then (the service decides per report).
 */
export function accidentActor(event: H3Event, user: SessionUser): AccidentActor {
  const manages = can(user.permissions, 'accidents.manage') && user.facilityId !== null
  return { user, facilityId: manages ? requireFacility(event, user) : null }
}
