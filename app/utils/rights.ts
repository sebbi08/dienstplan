import type { UserRightsDto, UserRightsInput } from '#shared/types/api'

/**
 * „darf Kinderakten pflegen“ for a Mitarbeiter account: the exception „eintragen und Akten ändern“ (own group) through
 * the rights API, which the Leitung may set for the Mitarbeiter of its facility. Keeps the person's other exceptions;
 * no exception at all when the role already gives what is wanted.
 */
export async function setChildEditing(userId: number, allowed: boolean): Promise<void> {
  const rights = await $fetch<UserRightsDto>(`/api/users/${userId}/rights`)
  const overrides: UserRightsInput['overrides'] = rights.bundles
    .filter(bundle => bundle.id !== 'childrenEdit' && bundle.override !== null)
    .map(bundle => ({ bundle: bundle.id, effect: bundle.override!.effect, scope: bundle.override!.scope }))
  const fromRole = rights.bundles.find(bundle => bundle.id === 'childrenEdit')?.role.enabled ?? false
  if (allowed !== fromRole) overrides.push({ bundle: 'childrenEdit', effect: allowed ? 'grant' : 'revoke', scope: allowed ? 'group' : null })
  await $fetch(`/api/users/${userId}/rights`, { method: 'PUT', body: { overrides } })
}
