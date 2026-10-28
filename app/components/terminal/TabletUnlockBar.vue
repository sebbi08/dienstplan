<script setup lang="ts">
import { KEEP_ALIVE_MIN_SECONDS, STATUS_POLL_SECONDS } from '#shared/domain/tablet'
import type { TabletUnlockStatusDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { isChildPagePath } from '~/utils/routeAccess'

/**
 * Shown at the tablet instead of the menu while a child page is open: who unlocked it and "Sperren". Tapping, typing
 * and scrolling count as use; the tablet locks itself once the lock time has passed without use (and on waking up
 * after it), and tells the server about use at most every KEEP_ALIVE_MIN_SECONDS. After a page reload the lock time
 * starts afresh (the server keeps its own time and refuses with 403 tablet_locked when that has run out).
 * Every STATUS_POLL_SECONDS it asks the server whether the unlock still holds, so a lock from elsewhere (shorter lock
 * time, another device unlocked, PIN or employment ended) shows at once, without waiting for the next touch.
 * While something on the page is unsaved (e.g. an observation form), „Sperren“ asks first, and shortly before the lock
 * time runs out a notice asks to tap and save (the lock itself never waits: the child data must go off the screen).
 */
const { unlock, lock } = useChildRights()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const status = computed(() => (unlock.value?.unlocked ? unlock.value : null))

let lastUse = 0
let lastKeepAlive = 0
let timer: ReturnType<typeof setTimeout> | undefined
let warnTimer: ReturnType<typeof setTimeout> | undefined
let warnedFor = -1
let poll: ReturnType<typeof setInterval> | undefined
let ending = false

const lockMs = () => (status.value?.lockMinutes ?? 0) * 60_000
const deadline = () => lastUse + lockMs()
/** How long before the lock the notice about unsaved changes comes: a minute, at most half the lock time. */
const warnMs = () => Math.min(60_000, lockMs() / 2)

/** Re-arms the notice for the current deadline; shows it once per period without use while something is unsaved. */
function armWarning() {
  clearTimeout(warnTimer)
  if (ending) return
  const remaining = deadline() - warnMs() - Date.now()
  if (remaining > 0) {
    warnTimer = setTimeout(armWarning, remaining)
    return
  }
  if (warnedFor === lastUse || Date.now() >= deadline()) return
  warnedFor = lastUse
  if (hasUnsavedChanges()) toast.add({ title: de.terminal.idleUnsavedWarning, color: 'warning', icon: 'i-lucide-lock', duration: warnMs() })
  // A touch moves the deadline: look again once this period would have ended.
  warnTimer = setTimeout(armWarning, Math.max(1000, deadline() - Date.now()))
}

/** „Sperren“: asks first while something on the page is unsaved. */
async function lockByHand() {
  if (hasUnsavedChanges() && !await confirm(de.terminal.lockUnsavedConfirm, { confirmLabel: de.terminal.lockDiscard, danger: true })) return
  end(true)
}

/**
 * Locks (unless already locked) and goes back to the tablet's start page; runs once. Locked while leaving the child
 * pages for another page (the middleware locks then, see lockOnLeave), the tablet stays on that page.
 */
async function end(sendLock: boolean) {
  if (ending) return
  ending = true
  clearTimeout(timer)
  clearTimeout(warnTimer)
  clearInterval(poll)
  if (sendLock) await lock()
  if (isChildPagePath(router.currentRoute.value.path)) await navigateTo('/terminal')
}

/** The server's view of the unlock; changes nothing there. `unlocked: false` ends the unlock here (watch below). */
async function pollStatus() {
  try {
    const next = await $fetch<TabletUnlockStatusDto>('/api/terminal/children/status')
    if (ending) return
    unlock.value = next
    // A changed lock time applies at once; a lock from elsewhere needs no lock request from here.
    if (next.unlocked) check()
  }
  catch {
    // Without an answer the next poll, use or request decides.
  }
}

/** Re-arms the timer for the current deadline (use only moves `lastUse`, so the timer is not reset on every event). */
function check() {
  clearTimeout(timer)
  if (ending) return
  const remaining = deadline() - Date.now()
  if (remaining <= 0) {
    end(true)
    return
  }
  timer = setTimeout(check, remaining)
  armWarning()
}

async function keepAlive() {
  try {
    const next = await $fetch<TabletUnlockStatusDto>('/api/terminal/children/keep-alive', { method: 'POST' })
    // A changed lock time or changed rights apply at once.
    if (ending) return
    unlock.value = next
    check()
  }
  catch {
    // 403 tablet_locked is handled by the tabletLocked plugin; other failures are retried with the next use after
    // KEEP_ALIVE_MIN_SECONDS (not at once, as scrolling fires many events).
  }
}

function onUse() {
  if (ending) return
  const now = Date.now()
  // A timer delayed by a sleeping device must not be outrun by the first touch after waking up.
  if (now >= deadline()) {
    end(true)
    return
  }
  lastUse = now
  if (now - lastKeepAlive >= KEEP_ALIVE_MIN_SECONDS * 1000) {
    lastKeepAlive = now
    keepAlive()
  }
}

function onVisibility() {
  if (document.visibilityState !== 'visible') return
  check()
  // Woken up within the lock time: whatever happened on the server meanwhile shows at once.
  if (!ending) void pollStatus()
}

// Locked from elsewhere (the plugin after 403 tablet_locked, or no status at all): back to the start page.
watch(status, (current) => {
  if (!current) end(false)
})

onMounted(() => {
  if (!status.value) {
    end(false)
    return
  }
  // The page has just loaded its data, which the server counts as use.
  lastUse = Date.now()
  lastKeepAlive = lastUse
  // Captured: scroll events do not bubble (a scrolled table or dialog counts too), and nothing can stop them on the way.
  window.addEventListener('pointerdown', onUse, { capture: true, passive: true })
  window.addEventListener('keydown', onUse, { capture: true, passive: true })
  window.addEventListener('scroll', onUse, { capture: true, passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  poll = setInterval(pollStatus, STATUS_POLL_SECONDS * 1000)
  check()
})

onBeforeUnmount(() => {
  ending = true
  clearTimeout(timer)
  clearTimeout(warnTimer)
  clearInterval(poll)
  window.removeEventListener('pointerdown', onUse, { capture: true })
  window.removeEventListener('keydown', onUse, { capture: true })
  window.removeEventListener('scroll', onUse, { capture: true })
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-2">
    <span class="flex items-center gap-2 font-medium">
      <UIcon name="i-lucide-lock-open" class="size-5 text-amber-600" />
      {{ status ? de.terminal.unlockedAs(status.name) : '' }}
    </span>
    <UButton class="ml-auto" size="lg" color="warning" icon="i-lucide-lock" :label="de.terminal.lock" @click="lockByHand" />
  </div>
</template>
