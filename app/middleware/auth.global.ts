export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value) return navigateTo('/login')
  if (user.value?.mustChangePassword && to.path !== '/account/password') return navigateTo('/account/password')
  if (to.path.startsWith('/admin') && user.value?.role !== 'admin') return navigateTo('/')
})
