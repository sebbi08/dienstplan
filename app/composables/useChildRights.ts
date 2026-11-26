import type { ChildRightsDto, TabletUnlockStatusDto } from '#shared/types/api'
import { REQUEST_TIMEOUT_MS } from '~/utils/offlineQueue'
import { lockNeedsRetry } from '~/utils/tabletLock'

/** The tablet's unlock as last reported by the server (null until asked); shared by the pages, the lock bar and the plugin. */
export function useTabletUnlock() {
  return useState<TabletUnlockStatusDto | null>('tablet-unlock', () => null)
}

/**
 * A lock the server has not confirmed yet (no answer, server error): the tablet sends it again until it has, and the
 * start page shows „Sperren…“ meanwhile. Until then the unlock – and with it „Dienstplan bearbeiten“ – may still hold on
 * the server; the plan pages never read the editor's data without the editor's own request, so the „Dienstplan“ tile
 * shows the released plan all the same.
 */
function useLockPending() {
  return useState<boolean>('tablet-lock-pending', () => false)
}

/** Between two tries of an unconfirmed lock. */
const LOCK_RETRY_MS = 3_000
let lockRetry: ReturnType<typeof setTimeout> | undefined

/**
 * Sends the lock of this tablet's unlock (only its own, the server knows it by the session) and, until the server has
 * confirmed it, again every LOCK_RETRY_MS. True when this try was confirmed. An answer that refuses it (no tablet
 * session any more) needs no retry: without the session there is no unlock to end.
 */
async function sendLock(): Promise<boolean> {
  const pending = useLockPending()
  clearTimeout(lockRetry)
  try {
    await $fetch<TabletUnlockStatusDto>('/api/terminal/children/lock', { method: 'POST', timeout: REQUEST_TIMEOUT_MS })
    pending.value = false
    return true
  }
  catch (error) {
    pending.value = lockNeedsRetry(error)
    if (pending.value) lockRetry = setTimeout(() => void sendLock(), LOCK_RETRY_MS)
    return false
  }
}

/** A new unlock replaced every earlier one on the server: a lock still waiting to be sent must not end the new one. */
function lockConfirmed() {
  clearTimeout(lockRetry)
  useLockPending().value = false
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

  /**
   * „Dienstplan bearbeiten“ at the tablet: what the person who unlocked it may do in the plan, from their own account
   * (null: they may not, or the tablet is locked). The server checks every plan request as well.
   */
  const planEdit = computed(() => (onTablet.value && unlock.value?.unlocked ? unlock.value.planEdit : null))
  /** The tablet's plan pages show the editor: the person who unlocked it edits the plan now. */
  const editingPlan = computed(() => planEdit.value?.active === true)

  /** Starts editing the plan with the current unlock (the server checks the unlock and the person's account). */
  async function startPlanEdit() {
    unlock.value = await $fetch<TabletUnlockStatusDto>('/api/terminal/plan-edit', { method: 'POST' })
  }

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

  /**
   * Locks: the screen at once, the server as soon as it answers (sendLock retries until it has confirmed; meanwhile
   * `lockPending` shows „Sperren…“). Resolves after the first try: true when the server confirmed it.
   */
  async function lock(): Promise<boolean> {
    if (!onTablet.value) return true
    unlock.value = { unlocked: false }
    return sendLock()
  }

  /**
   * The tablet leaves the child pages (or the plan editor) for another page (e.g. the plan): the unlock ends on the
   * server at once (retried until confirmed, see sendLock), and on the screen once that navigation is through - earlier,
   * the lock bar still on screen would take the tablet to its start page instead of where it is going.
   */
  function lockOnLeave() {
    if (!onTablet.value) return
    void sendLock()
    const stop = router.afterEach(() => {
      stop()
      unlock.value = { unlocked: false }
    })
  }

  return {
    rights, onTablet, unlock, planEdit, editingPlan, startPlanEdit, refreshUnlock, lock, lockOnLeave,
    lockPending: useLockPending(), lockConfirmed,
  }
}
