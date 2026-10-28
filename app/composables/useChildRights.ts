import type { ChildRightsDto, TabletUnlockStatusDto } from '#shared/types/api'

/** The tablet's unlock as last reported by the server (null until asked); shared by the pages, the lock bar and the plugin. */
export function useTabletUnlock() {
  return useState<TabletUnlockStatusDto | null>('tablet-unlock', () => null)
}

/**
 * What the child pages may show: in the office the signed-in account's rights, at the tablet those of the person who
 * unlocked it (null while it is locked). The server checks every request as well.
 */
export function useChildRights() {
  const { user } = useUserSession()
  const unlock = useTabletUnlock()
  // On the server this forwards the tablet's cookie (the middleware asks for the status during a full page load).
  const requestFetch = useRequestFetch()
  const router = useRouter()
  const onTablet = computed(() => user.value?.role === 'terminal')

  const { can } = useCan()
  const rights = computed<ChildRightsDto | null>(() => {
    const current = user.value
    if (!current) return null
    // At the tablet the server's answer for the unlocking person (tabletUnlock.ts rightsOf, from their permissions).
    if (current.role === 'terminal') return unlock.value?.unlocked ? unlock.value.rights : null
    // In the office the account's own permissions, as the tablet's rights are built from the unlocking person's.
    return {
      canEdit: can('children.edit'),
      isManager: can('children.manage'),
      canMoveFacility: can('children.moveFacility'),
      showWaitlist: true,
      showFutureContracts: true,
    }
  })

  async function refreshUnlock() {
    if (!onTablet.value) return
    try {
      unlock.value = await requestFetch<TabletUnlockStatusDto>('/api/terminal/children/status')
    }
    catch {
      // Without an answer the tablet counts as locked; the start page is always reachable.
      unlock.value = { unlocked: false }
    }
  }

  async function lock() {
    if (!onTablet.value) return
    unlock.value = { unlocked: false }
    try {
      await $fetch<TabletUnlockStatusDto>('/api/terminal/children/lock', { method: 'POST' })
    }
    catch {
      // The server ends the unlock after the lock time anyway.
    }
  }

  /**
   * The tablet leaves the child pages for another page (e.g. the plan): the unlock ends on the server at once (best
   * effort), and on the screen once that navigation is through - earlier, the lock bar still on screen would take the
   * tablet to its start page instead of where it is going.
   */
  function lockOnLeave() {
    if (!onTablet.value) return
    $fetch<TabletUnlockStatusDto>('/api/terminal/children/lock', { method: 'POST' }).catch(() => {
      // The server ends the unlock after the lock time anyway.
    })
    const stop = router.afterEach(() => {
      stop()
      unlock.value = { unlocked: false }
    })
  }

  return { rights, onTablet, unlock, refreshUnlock, lock, lockOnLeave }
}
