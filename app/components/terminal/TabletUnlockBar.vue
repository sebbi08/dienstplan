<script setup lang="ts">
import { KEEP_ALIVE_MIN_SECONDS } from '#shared/domain/tablet'
import type { TabletUnlockStatusDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Shown at the tablet instead of the menu while a child page is open: who unlocked it and "Sperren". Tapping, typing
 * and scrolling count as use; the tablet locks itself once the lock time has passed without use (and on waking up
 * after it), and tells the server about use at most every KEEP_ALIVE_MIN_SECONDS. After a page reload the lock time
 * starts afresh (the server keeps its own time and refuses with 403 tablet_locked when that has run out).
 */
const { unlock, lock } = useChildRights()
const status = computed(() => (unlock.value?.unlocked ? unlock.value : null))

let lastUse = 0
let lastKeepAlive = 0
let timer: ReturnType<typeof setTimeout> | undefined
let ending = false

const deadline = () => lastUse + (status.value?.lockMinutes ?? 0) * 60_000

/** Locks (unless already locked) and goes back to the tablet's start page; runs once. */
async function end(sendLock: boolean) {
  if (ending) return
  ending = true
  clearTimeout(timer)
  if (sendLock) await lock()
  await navigateTo('/terminal')
}

/** Re-arms the timer for the current deadline (use only moves `lastUse`, so the timer is not reset on every event). */
function check() {
  clearTimeout(timer)
  if (ending) return
  const remaining = deadline() - Date.now()
  if (remaining <= 0) end(true)
  else timer = setTimeout(check, remaining)
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
  if (document.visibilityState === 'visible') check()
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
  check()
})

onBeforeUnmount(() => {
  ending = true
  clearTimeout(timer)
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
    <UButton class="ml-auto" size="lg" color="warning" icon="i-lucide-lock" :label="de.terminal.lock" @click="end(true)" />
  </div>
</template>
