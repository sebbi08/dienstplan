import type { PermissionKey } from '#shared/domain/permissions'

/**
 * What the signed-in account may do, for what the pages show: the permissions the server resolved with the last session
 * answer (server/plugins/sessionCheck.ts; refreshed with the role, e.g. on a page load or after the login). Reactive,
 * so `can` works in computed values and templates. The tablet has none: its pages follow the terminal role, and the
 * child pages there the rights of the person who unlocked it (useChildRights). The server checks every request as well.
 */
export function useCan() {
  const { session } = useUserSession()
  const granted = computed(() => new Set<PermissionKey>(session.value?.permissions ?? []))
  const can = (key: PermissionKey): boolean => granted.value.has(key)
  return { can }
}
