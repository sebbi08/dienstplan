import { de } from '~/locales/de'

/**
 * Tells the Träger that the server switched the automatic leaving of school children off (a changed cutoff, a group that
 * lost the flag "für Schulkinder" or was deleted): they have to check the list and switch it on again.
 */
export function useAutoLeaveNotice() {
  const toast = useToast()
  return () => toast.add({ title: de.schoolChildren.switchedOff, color: 'warning', icon: 'i-lucide-triangle-alert', duration: 15000 })
}
