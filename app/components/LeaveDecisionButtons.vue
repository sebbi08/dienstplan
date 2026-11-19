<script setup lang="ts">
import type { LeaveRequestDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Genehmigen“ and „Ablehnen“ of an open request („Urlaubsplanung“: Planung and Alle Anträge und Urlaube). Approving over
 * planned duties asks first (cells_occupied) and then replaces them; rejecting asks for an optional reason. `decided`
 * after either, so the page reloads (and the open-request count in the menu).
 */
const props = defineProps<{ request: LeaveRequestDto }>()
const emit = defineEmits<{ decided: [] }>()
const run = useAction()
const confirm = useConfirm()
const toast = useToast()

async function approve() {
  const request = props.request
  const send = (overwrite: boolean) => $fetch<{ keptAbsences: number }>(`/api/leave-requests/${request.id}/decide`, {
    method: 'POST', body: { approve: true, note: '', overwrite },
  })
  let result: { keptAbsences: number } | undefined
  try {
    result = await send(false)
  }
  catch (failure) {
    const data = (failure as { data?: { data?: { code?: string; details?: { days?: number; entries?: boolean } } } }).data?.data
    if (data?.code !== 'cells_occupied') {
      toast.add({ title: errorMessage(failure), color: 'error' })
      return
    }
    if (!await confirm(de.leavePlanning.overwriteConfirm(data.details?.days ?? 0, de.leaveRequests.kinds[request.kind], data.details?.entries), { confirmLabel: de.leavePlanning.overwrite, danger: false })) return
    if (!await run(async () => { result = await send(true) })) return
  }
  emit('decided')
  const kept = result?.keptAbsences ?? 0
  toast.add({ title: kept ? de.leavePlanning.approvedKept(kept, de.leaveRequests.kinds[request.kind]) : de.leavePlanning.approved, color: 'success' })
}

const rejectOpen = ref(false)
const note = ref('')
function openReject() {
  note.value = ''
  rejectOpen.value = true
}
async function reject() {
  const ok = await run(() => $fetch<unknown>(`/api/leave-requests/${props.request.id}/decide`, {
    method: 'POST', body: { approve: false, note: note.value, overwrite: false },
  }), de.leavePlanning.rejected)
  if (!ok) return
  rejectOpen.value = false
  emit('decided')
}
</script>

<template>
  <span class="flex gap-1">
    <UButton size="xs" icon="i-lucide-check" :label="de.leavePlanning.approve" @click="approve" />
    <UButton size="xs" color="error" variant="outline" icon="i-lucide-x" :label="de.leavePlanning.reject" @click="openReject" />
    <UModal v-model:open="rejectOpen" :title="de.leavePlanning.rejectTitle">
      <template #body>
        <form class="space-y-3" @submit.prevent="reject">
          <p class="text-sm">{{ request.name }}: {{ formatDate(request.startDate) }} – {{ formatDate(request.endDate) }}</p>
          <UFormField :label="de.leavePlanning.reason"><UInput v-model="note" maxlength="300" class="w-full" /></UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="rejectOpen = false" />
            <UButton type="submit" color="error" :label="de.leavePlanning.reject" />
          </div>
        </form>
      </template>
    </UModal>
  </span>
</template>
