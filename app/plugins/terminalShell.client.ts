/**
 * The offline shell of the stamping page (public/terminal-sw.js) belongs to the tablet account only: when another
 * account is signed in on a device that has it (e.g. the Leitung on the tablet), the worker and its kept files go. The
 * queue of offline stamps in IndexedDB stays, so nothing stamped is lost; the tablet sends it when it is back.
 */
export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  const { user } = useUserSession()
  watch(() => user.value?.role, (role) => {
    if (!role || role === 'terminal') return
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations
        .filter(registration => new URL(registration.scope).pathname === '/terminal')
        .map(registration => registration.unregister())))
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.filter(key => key.startsWith('terminal-shell-')).map(key => caches.delete(key))))
      .catch(() => {})
  }, { immediate: true })
})
