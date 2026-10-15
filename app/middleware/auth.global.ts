import { isManager } from '#shared/domain/roles'

export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value) return navigateTo('/login')
  const childPage = to.path === '/children' || to.path.startsWith('/children/')
  if (user.value?.role === 'terminal') {
    // The child pages only while a person has unlocked them (asked afresh, also on a full page load).
    if (childPage) {
      const { unlock, refreshUnlock } = useChildRights()
      await refreshUnlock()
      return unlock.value?.unlocked ? undefined : navigateTo('/terminal')
    }
    // Otherwise the shared tablet only stamps and shows the general plan.
    return to.path === '/terminal' || to.path.startsWith('/plan/') ? undefined : navigateTo('/terminal')
  }
  if (user.value?.mustChangePassword && to.path !== '/account/password') return navigateTo('/account/password')
  // Mitarbeiter see the children only at the facility's tablet (and printouts of them nowhere; the tablet never gets
  // to /print above).
  if ((childPage || to.path.startsWith('/print/children/')) && user.value?.role === 'observer') return navigateTo('/')
  if ((to.path.startsWith('/admin') || to.path === '/terminal') && !isManager(user.value?.role)) return navigateTo('/')
})
