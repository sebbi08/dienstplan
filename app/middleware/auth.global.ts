import { isManager } from '#shared/domain/roles'
import { isChildPagePath } from '~/utils/children'

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value) return navigateTo('/login')
  const childPage = isChildPagePath(to.path)
  if (user.value?.role === 'terminal') {
    // The child pages only while a person has unlocked them (asked afresh, also on a full page load).
    if (childPage) {
      const { unlock, refreshUnlock } = useChildRights()
      await refreshUnlock()
      return unlock.value?.unlocked ? undefined : navigateTo('/terminal')
    }
    // Leaving the child pages (e.g. for the plan) ends the unlock, so it does not stay alive behind the tablet's back;
    // the start page locks by itself.
    if (import.meta.client && isChildPagePath(from.path) && to.path !== '/terminal') useChildRights().lockOnLeave()
    // Otherwise the shared tablet only stamps, shows the general plan and the print templates (no unlock: no child data).
    return to.path === '/terminal' || to.path === '/templates' || to.path.startsWith('/plan/') ? undefined : navigateTo('/terminal')
  }
  if (user.value?.mustChangePassword && to.path !== '/account/password') return navigateTo('/account/password')
  // Mitarbeiter see the children only at the facility's tablet (and printouts of them nowhere; the tablet never gets
  // to /print above).
  if ((childPage || to.path.startsWith('/print/children/')) && user.value?.role === 'observer') return navigateTo('/')
  // The print templates are for the managers and the tablet, not for the staff's phones; the cash books only for managers.
  if ((to.path.startsWith('/admin') || to.path === '/cash' || to.path.startsWith('/cash/') || to.path === '/terminal' || to.path === '/templates') && !isManager(user.value?.role)) {
    return navigateTo('/')
  }
})
