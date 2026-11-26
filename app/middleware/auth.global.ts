import { accountRedirect, isChildPagePath, isPlanEditorView, tabletMayOpen } from '~/utils/routeAccess'

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value || !user.value) return navigateTo('/login')
  if (user.value.role === 'terminal') {
    const { unlock, editingPlan, refreshUnlock, lockOnLeave } = useChildRights()
    // The child pages only while a person has unlocked them (asked afresh, also on a full page load).
    if (isChildPagePath(to.path)) {
      await refreshUnlock()
      return unlock.value?.unlocked ? undefined : navigateTo('/terminal')
    }
    // A full page load of the plan editor's view asks whether a person edits the plan here („Dienstplan bearbeiten“):
    // then the page shows the editor and the lock bar. The „Dienstplan“ tile's view (no `?editor=1`) never asks, so a
    // reload of it never opens the editor.
    if (import.meta.server && isPlanEditorView(to.path, to.query)) await refreshUnlock()
    // Leaving the child pages (e.g. for the plan) ends the unlock, so it does not stay alive behind the tablet's back;
    // so does leaving the plan editor for anything but another month of it. Into the plan editor (started from the
    // child pages) the unlock goes along. The start page locks by itself.
    const editorStays = editingPlan.value && isPlanEditorView(to.path, to.query)
    const leaving = isChildPagePath(from.path) || (editingPlan.value && isPlanEditorView(from.path, from.query))
    if (import.meta.client && leaving && !editorStays && to.path !== '/terminal') lockOnLeave()
    return tabletMayOpen(to.path) ? undefined : navigateTo('/terminal')
  }
  const { can } = useCan()
  const target = accountRedirect(to.path, { mustChangePassword: user.value.mustChangePassword, can })
  return target ? navigateTo(target) : undefined
})
