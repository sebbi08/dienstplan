import { de } from '~/locales/de'

interface ConfirmRequest {
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (confirmed: boolean) => void
}

// Only ever set from client-side event handlers, so a module-level ref is safe here.
const pending = shallowRef<ConfirmRequest | null>(null)

/**
 * In-app replacement for window.confirm (native dialogs are blocked in some embedded browsers).
 * Resolves to true only when the user clicks the confirm button.
 */
export function useConfirm() {
  return function confirm(message: string, options: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    pending.value?.resolve(false)
    return new Promise((resolve) => {
      pending.value = {
        message,
        confirmLabel: options.confirmLabel ?? de.common.delete,
        danger: options.danger ?? true,
        resolve,
      }
    })
  }
}

/** State for the single <ConfirmDialog> mounted in app.vue. */
export function useConfirmRequest() {
  function settle(confirmed: boolean) {
    const request = pending.value
    pending.value = null
    request?.resolve(confirmed)
  }
  return { request: readonly(pending), settle }
}
