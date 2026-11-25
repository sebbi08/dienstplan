import type { SignRequestDto, SignRequestRecipientDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

/**
 * The requests to sign the viewer sees (GET /api/sign-requests, signRequests.manage; one copy per page under the key
 * `sign-requests`): Mitarbeitende → Unterschriften, the hints in the list of Mitarbeitende and the box on a person's tab
 * „Nachweise“. Not loaded without the right; `immediate: false` waits for `execute()` (a tab opened later).
 */
export function useSignRequests(options: { immediate?: boolean } = {}) {
  const { can } = useCan()
  return useFetch<SignRequestDto[]>('/api/sign-requests', {
    key: 'sign-requests', default: () => [], immediate: (options.immediate ?? true) && can('signRequests.manage'),
  })
}

/**
 * „Erinnern“, „Zurückziehen“ (one open person or all) and „Anfrage löschen“, each asked first where it ends something;
 * afterwards the requests and the overdue count of the menu are loaded again.
 */
export function useSignRequestActions() {
  const t = de.signRequests
  const toast = useToast()
  const confirm = useConfirm()
  const busy = ref(false)

  async function act(run: () => Promise<unknown>, success?: string) {
    if (busy.value) return
    busy.value = true
    try {
      await run()
      if (success) toast.add({ title: success, color: 'success' })
      await refreshNuxtData(['sign-requests', 'sign-overdue-count'])
    }
    catch (caught) {
      toast.add({ title: errorMessage(caught), color: 'error' })
    }
    finally {
      busy.value = false
    }
  }

  const openOf = (request: SignRequestDto) => request.recipients.filter(recipient => recipient.status === 'open')

  function remind(request: SignRequestDto, recipient: SignRequestRecipientDto | null) {
    void act(() => $fetch<{ count: number }>(`/api/sign-requests/${request.id}/remind`, { method: 'POST', body: { recipientId: recipient?.id ?? null } }), t.reminded)
  }
  async function withdraw(request: SignRequestDto, recipient: SignRequestRecipientDto | null) {
    const question = recipient ? t.confirmWithdraw(recipient.name) : t.confirmWithdrawAll(openOf(request).length)
    if (!(await confirm(question, { confirmLabel: t.withdraw, danger: true }))) return
    void act(() => $fetch<{ count: number }>(`/api/sign-requests/${request.id}/withdraw`, { method: 'POST', body: { recipientId: recipient?.id ?? null } }), t.withdrawn)
  }
  async function remove(request: SignRequestDto) {
    if (!(await confirm(t.confirmDelete(request.title), { confirmLabel: t.deleteRequest, danger: true }))) return
    void act(() => $fetch<unknown>(`/api/sign-requests/${request.id}`, { method: 'DELETE' }), de.common.deleted)
  }

  return { busy, openOf, remind, withdraw, remove }
}
