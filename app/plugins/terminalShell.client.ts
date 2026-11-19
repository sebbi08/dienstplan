import { clearTeam, offlineStorageAvailable } from '~/utils/offlineStore'

/** Removes the offline shell of the stamping page (public/terminal-sw.js) and its kept files from this device. */
function removeShell() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.getRegistrations()
    .then(registrations => Promise.all(registrations
      .filter(registration => new URL(registration.scope).pathname === '/terminal')
      .map(registration => registration.unregister())))
    .then(() => caches.keys())
    .then(keys => Promise.all(keys.filter(key => key.startsWith('terminal-shell-')).map(key => caches.delete(key))))
    .catch(() => {})
}

/**
 * The offline shell of the stamping page belongs to the tablet account only: when another account is signed in on a
 * device that has it (e.g. the Leitung on the tablet), the worker and its kept files go; when the tablet account signs
 * out, also the cached team list. The queue of offline stamps in IndexedDB stays, so nothing stamped is lost; the
 * tablet sends it when it is signed in again.
 */
export default defineNuxtPlugin(() => {
  const { user } = useUserSession()
  watch(() => user.value?.role, (role, previous) => {
    if (role === 'terminal') return
    if (role) removeShell()
    if (previous === 'terminal') {
      removeShell()
      if (offlineStorageAvailable()) clearTeam().catch(() => {})
    }
  }, { immediate: true })
})
