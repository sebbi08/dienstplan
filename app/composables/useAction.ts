import { errorMessage } from '~/utils/errors'

/** Runs an API call, refreshes data on success and reports errors as toasts. */
export function useAction(refresh?: () => Promise<unknown>) {
  const toast = useToast()
  return async function run(action: () => Promise<unknown>, successMessage?: string): Promise<boolean> {
    try {
      await action()
      if (refresh) await refresh()
      if (successMessage) toast.add({ title: successMessage, color: 'success' })
      return true
    }
    catch (error) {
      toast.add({ title: errorMessage(error), color: 'error' })
      return false
    }
  }
}
