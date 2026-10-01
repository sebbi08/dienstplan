export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value) return navigateTo('/login')
  if (user.value?.role === 'terminal') {
    // The shared tablet only stamps and shows the general plan.
    return to.path === '/terminal' || to.path.startsWith('/plan/') ? undefined : navigateTo('/terminal')
  }
  if (user.value?.mustChangePassword && to.path !== '/account/password') return navigateTo('/account/password')
  if ((to.path.startsWith('/admin') || to.path === '/terminal') && user.value?.role !== 'admin') return navigateTo('/')
})
