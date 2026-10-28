import { accountRedirect, isChildPagePath, tabletMayOpen } from '~/utils/routeAccess'

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value || !user.value) return navigateTo('/login')
  if (user.value.role === 'terminal') {
    // The child pages only while a person has unlocked them (asked afresh, also on a full page load).
    if (isChildPagePath(to.path)) {
      const { unlock, refreshUnlock } = useChildRights()
      await refreshUnlock()
      return unlock.value?.unlocked ? undefined : navigateTo('/terminal')
    }
    // Leaving the child pages (e.g. for the plan) ends the unlock, so it does not stay alive behind the tablet's back;
    // the start page locks by itself.
    if (import.meta.client && isChildPagePath(from.path) && to.path !== '/terminal') useChildRights().lockOnLeave()
    return tabletMayOpen(to.path) ? undefined : navigateTo('/terminal')
  }
  const { can } = useCan()
  const target = accountRedirect(to.path, { mustChangePassword: user.value.mustChangePassword, can })
  return target ? navigateTo(target) : undefined
})
