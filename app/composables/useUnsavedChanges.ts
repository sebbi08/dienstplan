import { de } from '~/locales/de'

// The forms on screen with unsaved edits. Only filled on the client (onMounted), so the server never keeps any of it.
const sources = shallowReactive(new Map<number, () => boolean>())
let lastId = 0

/** Whether two form values are the same (plain data: numbers, texts, flags, arrays and objects of them). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * A section tells whether its form differs from the stored value. The save button follows it, and the settings pages ask
 * before they are left while any section on screen has unsaved edits.
 */
export function useDirty(isDirty: () => boolean) {
  const dirty = computed(isDirty)
  const id = ++lastId
  onMounted(() => sources.set(id, () => dirty.value))
  onBeforeUnmount(() => sources.delete(id))
  return dirty
}

/** True while any form on screen has unsaved edits. */
export const hasUnsavedChanges = () => [...sources.values()].some(isDirty => isDirty())

/**
 * The guard of the settings pages: going to another area, a group's page or anywhere else while edits are unsaved asks
 * first (a jump within the same page, e.g. to a section, does not); closing or reloading the tab asks the browser.
 * At the tablet a lock (lock time over, locked from elsewhere, „Sperren“ confirmed) always leaves the child pages at
 * once: the child data must go off the screen and nothing could be saved any more (the lock bar warns before the lock
 * time runs out, and „Sperren“ asks first).
 */
export function useUnsavedGuard() {
  const confirm = useConfirm()
  const { user } = useUserSession()
  const unlock = useTabletUnlock()
  const guard = async (to: { path: string }, from: { path: string }) => {
    if (to.path === from.path || !hasUnsavedChanges()) return true
    if (user.value?.role === 'terminal' && !unlock.value?.unlocked) return true
    return await confirm(de.settingsAreas.unsavedConfirm, { confirmLabel: de.settingsAreas.unsavedLeave, danger: true })
  }
  onBeforeRouteLeave(guard)
  onBeforeRouteUpdate(guard)
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    // Older browsers need a value to show their dialog.
    event.returnValue = ''
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
}
