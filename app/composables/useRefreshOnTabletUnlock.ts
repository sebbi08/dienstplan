/**
 * At the tablet, Vorlagen and „Wissen“ limited to groups depend on who unlocked it (their home group): the lists load
 * afresh when the unlock changes (another person, locked). Leaving the child pages locks the tablet, and the lock time
 * runs out on the server without a request, so while unlocked this page asks for the unlock state every minute (the
 * status request does not count as use and so never keeps the tablet unlocked).
 */
export function useRefreshOnTabletUnlock(refresh: () => unknown): void {
  const { onTablet, unlock, refreshUnlock } = useChildRights()
  if (!import.meta.client) return
  watch(() => (unlock.value?.unlocked ? unlock.value.employeeId : null), (now, before) => {
    if (now !== before) refresh()
  })
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    if (!onTablet.value) return
    timer = setInterval(() => {
      if (unlock.value?.unlocked) refreshUnlock()
    }, 60_000)
  })
  onBeforeUnmount(() => clearInterval(timer))
}
