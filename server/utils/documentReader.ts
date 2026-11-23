import type { H3Event } from 'h3'
import type { SessionUser } from '../../shared/types/api'
import { readerHomeGroup } from '../services/documentTargets'

/**
 * Whoever reads Vorlagen or „Wissen“ (after their route guard), with the home group that decides which items limited to
 * groups they see (shared/domain/documentTargets.ts): an account its linked employee's group; the facility's tablet the
 * group of the person who unlocked it, none while it is locked (see readerHomeGroup).
 */
export async function withHomeGroup<T extends Pick<SessionUser, 'id' | 'role' | 'employeeId' | 'facilityId'>>(
  event: H3Event, user: T,
): Promise<T & { homeGroupId: number | null }> {
  const token = user.role === 'terminal' ? await childUnlockToken(event) : undefined
  return { ...user, homeGroupId: readerHomeGroup(useDb(), user, token) }
}
