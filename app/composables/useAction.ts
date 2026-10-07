import { errorCode, errorMessage } from '~/utils/errors'

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
      // The page reloads and says so itself (plugins/pageFacility.client.ts).
      if (errorCode(error) !== 'facility_changed') toast.add({ title: errorMessage(error), color: 'error' })
      return false
    }
  }
}
