import { OFFLINE_BATCH_MAX } from '#shared/domain/offlineStamps'
import type { OfflineStampResultDto, StampAction } from '#shared/types/api'
import {
  buildSyncPayload, isoWithOffset, isRateLimited, isServerUnreachable, REQUEST_TIMEOUT_MS, retryDelay, settledIds, sortQueue,
} from '~/utils/offlineQueue'
import {
  decryptPin, enqueueStamp, loadQueue, loadTeam, offlineStorageAvailable, queueSize, removeFromQueue, saveTeam, type TeamMember,
} from '~/utils/offlineStore'

/** The worker that keeps the stamping page for use without network (public/terminal-sw.js), only below /terminal. */
const SHELL_WORKER = '/terminal-sw.js'
const SHELL_SCOPE = '/terminal'

/**
 * Stamping at the facility tablet without network (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“), for the stamping
 * page: whether the server is unreachable, how many stamps wait, keeping a stamp in the queue and sending the queue.
 * The queue is sent on page load, when the browser reports the network back, after every successful request of the
 * page (`noteReachable`), and while stamps wait and sending failed, again after 5, 10, 20, 40 seconds and then every 60
 * seconds (no tighter loop). `onSynced` runs after stamps were sent and when the network is back (the page reloads the team list). Only the tablet
 * account keeps stamps (`enabled`); for anybody else stamping here stays online only.
 */
export function useOfflineStamps(enabled: boolean, onSynced: () => void) {
  const offline = ref(false)
  const pending = ref(0)
  /** The last sending failed with an answer of the server (not for lack of network): the stamps wait for the next try. */
  const syncFailed = ref(false)
  const available = enabled && import.meta.client && offlineStorageAvailable()
  let syncing: Promise<void> | null = null
  let failedTries = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function refreshPending() {
    if (!available) return
    try {
      pending.value = await queueSize()
    }
    catch {
      // Storage not readable right now: keep the last count.
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer)
    if (stopped || pending.value === 0) return
    retryTimer = setTimeout(() => void sync(), retryDelay(Math.max(1, failedTries)))
  }

  async function sendOnce(): Promise<void> {
    const queue = sortQueue(await loadQueue()).slice(0, OFFLINE_BATCH_MAX)
    if (queue.length === 0) {
      pending.value = 0
      return
    }
    // A PIN that cannot be decrypted (key lost) is sent empty: the server refuses it with a hint, and the queue is cleaned.
    const items = await Promise.all(queue.map(async entry => ({ ...entry, pin: await decryptPin(entry.pin).catch(() => '') })))
    try {
      const { results } = await $fetch<{ results: OfflineStampResultDto[] }>('/api/terminal/offline-stamps', {
        method: 'POST', body: buildSyncPayload(items, new Date()), timeout: REQUEST_TIMEOUT_MS,
      })
      await removeFromQueue(settledIds(results))
      offline.value = false
      syncFailed.value = false
      failedTries = 0
      await refreshPending()
      onSynced()
      // More than one request's worth: the next part right away.
      if (pending.value > 0 && results.length > 0) return sendOnce()
      if (pending.value > 0) scheduleRetry()
    }
    catch (error) {
      if (isServerUnreachable(error)) offline.value = true
      // The server answered with an error (not „too many requests“): the stamps wait, and the page says so.
      else if (!isRateLimited(error)) syncFailed.value = true
      failedTries++
      scheduleRetry()
    }
  }

  /** Sends the queue (once at a time; a call while sending waits for that run). */
  function sync(): Promise<void> {
    if (!available || stopped) return Promise.resolve()
    clearTimeout(retryTimer)
    syncing ??= sendOnce().catch(() => {
      // Storage errors: try again later.
      failedTries++
      scheduleRetry()
    }).finally(() => {
      syncing = null
    })
    return syncing
  }

  /**
   * A request of the page went through: the server is reachable again, waiting stamps go now (after a refusal by the
   * server only with the next retry, not with every request).
   */
  function noteReachable() {
    const wasOffline = offline.value
    offline.value = false
    if (pending.value > 0 && (wasOffline || !syncFailed.value)) void sync()
  }

  /** A request failed without answer: the yellow bar shows and stamps are kept. */
  function noteUnreachable() {
    offline.value = true
  }

  /** Keeps a stamp in the queue with the tablet's clock now; returns that moment for the confirmation. */
  async function keep(stamp: { employeeId: number; name: string; action: StampAction; pin: string }): Promise<Date> {
    if (!available) throw new Error('offline storage unavailable')
    const at = new Date()
    await enqueueStamp({ ...stamp, stampedAt: isoWithOffset(at) })
    await refreshPending()
    scheduleRetry()
    return at
  }

  /** Remembers the team list for stamping without network: employee id and name only. */
  function rememberTeam(people: readonly TeamMember[]) {
    if (available) saveTeam(people).catch(() => {})
  }

  async function cachedTeam(): Promise<TeamMember[]> {
    return available ? loadTeam().catch(() => []) : []
  }

  /**
   * Registers the worker that keeps the stamping page for use without network (tablet only, not in development). The
   * files this page already loaded before the worker took over are handed to it, so they are kept as well.
   */
  async function registerShell() {
    if (import.meta.dev || !('serviceWorker' in navigator)) return
    try {
      const buildId = useRuntimeConfig().app.buildId
      const registration = await navigator.serviceWorker.register(`${SHELL_WORKER}?v=${encodeURIComponent(buildId)}`, { scope: SHELL_SCOPE })
      const urls = performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(url => new URL(url).origin === location.origin && new URL(url).pathname.startsWith('/_nuxt/'))
      ;(registration.installing ?? registration.waiting ?? registration.active)?.postMessage({ type: 'keep', urls })
    }
    catch {
      // Without the worker the page still works online.
    }
  }

  /** The browser reports the network back: send the queue, and let the page ask the server (which ends the bar). */
  function onOnline() {
    void sync()
    onSynced()
  }
  function onOffline() {
    offline.value = true
  }

  onMounted(() => {
    if (!enabled) return
    if (!navigator.onLine) offline.value = true
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refreshPending().then(() => sync())
  })
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(retryTimer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  })

  return {
    offline: readonly(offline), pending: readonly(pending), syncFailed: readonly(syncFailed), available, sync, noteReachable, noteUnreachable, keep, rememberTeam,
    cachedTeam, registerShell,
  }
}
