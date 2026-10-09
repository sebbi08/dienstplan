/**
 * A flag for "a request is running" and a guard that lets only one request through at a time (no double submit).
 * `guard` resolves to false without running anything while another request is busy.
 */
export function useBusy() {
  const busy = ref(false)
  async function guard(action: () => Promise<boolean>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try {
      return await action()
    }
    finally {
      busy.value = false
    }
  }
  return { busy, guard }
}

/** `useAction` (refresh, success toast, error toast) that also runs one request at a time and tells whether it is busy. */
export function useBusyAction(refresh?: () => Promise<unknown>) {
  const runAction = useAction(refresh)
  const { busy, guard } = useBusy()
  const run = (action: () => Promise<unknown>, successMessage?: string): Promise<boolean> => guard(() => runAction(action, successMessage))
  return { busy, run }
}
