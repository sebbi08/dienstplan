import { de } from '~/locales/de'

interface ConfirmRequest {
  message: string
  confirmLabel: string
  /** The other button: „Abbrechen“, or „Nein“ for a yes/no question. */
  cancelLabel: string
  danger: boolean
  /** true = the confirm button, false = the other button, null = closed without an answer (X, Escape, outside). */
  resolve: (answer: boolean | null) => void
}

interface ConfirmOptions { confirmLabel?: string; cancelLabel?: string; danger?: boolean }

// Only ever set from client-side event handlers, so a module-level ref is safe here.
const pending = shallowRef<ConfirmRequest | null>(null)

function open(message: string, options: ConfirmOptions): Promise<boolean | null> {
  pending.value?.resolve(null)
  return new Promise((resolve) => {
    pending.value = {
      message,
      confirmLabel: options.confirmLabel ?? de.common.delete,
      cancelLabel: options.cancelLabel ?? de.common.cancel,
      danger: options.danger ?? true,
      resolve,
    }
  })
}

/**
 * In-app replacement for window.confirm (native dialogs are blocked in some embedded browsers).
 * Resolves to true only when the user clicks the confirm button.
 */
export function useConfirm() {
  return async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    return (await open(message, options)) === true
  }
}

/**
 * A yes/no question in the same dialog: true for the confirm button, false for the other one, null when it was closed
 * without an answer (then the caller does nothing).
 */
export function useQuestion() {
  return function ask(message: string, options: ConfirmOptions = {}): Promise<boolean | null> {
    return open(message, options)
  }
}

/** State for the single <ConfirmDialog> mounted in app.vue. */
export function useConfirmRequest() {
  function settle(answer: boolean | null) {
    const request = pending.value
    pending.value = null
    request?.resolve(answer)
  }
  return { request: readonly(pending), settle }
}
