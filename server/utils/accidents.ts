import type { H3Event } from 'h3'
import { can } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import type { ChildViewer } from '../lib/childViewer'
import type { AccidentActor } from '../services/accidents'
import { resolveChildViewer } from '../services/tabletUnlock'

/**
 * The account as the employee accident routes work with it (after `requireUser`, so never the tablet): with
 * accidents.manage the facility it works in (stale-page checks as everywhere), else none, as only its own reports are
 * open to it then (the service decides per report).
 */
export function accidentActor(event: H3Event, user: SessionUser): AccidentActor {
  const manages = can(user.permissions, 'accidents.manage') && user.facilityId !== null
  return { user, facilityId: manages ? requireFacility(event, user) : null }
}

/**
 * The overview's view of the child records for an office account that already passed its guard (its facility the one of
 * the request): as the child pages see them with the own account, or null without children.ownAccount (the overview then
 * lists only the employees' reports instead of failing).
 */
export function accidentChildViewer(user: SessionUser): ChildViewer | null {
  if (!can(user.permissions, 'children.ownAccount') || user.facilityId === null) return null
  return resolveChildViewer(useDb(), user, undefined)
}
