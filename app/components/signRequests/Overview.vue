<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { SignRequestDto, SignRequestRecipientDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { employeeDocumentUrl } from '~/utils/personnel'

/**
 * Mitarbeitende → Unterschriften (signRequests.manage): the requests to sign sent from the facility, newest first, each
 * with its recipients (offen, unterschrieben am …, abgelehnt mit Grund, zurückgezogen), the signed copy when the viewer may
 * use its folder, „Erinnern“ and „Zurückziehen“ (one or all open ones), the sent PDF and deleting the request. Overdue
 * requests are marked and counted at the top.
 */
const t = de.signRequests
const { data, error, status } = useSignRequests()
const requests = computed(() => data.value ?? [])
const overdueCount = computed(() => requests.value.filter(request => request.overdue).length)
const { busy, openOf, remind, withdraw, remove } = useSignRequestActions()
const signedOf = (request: SignRequestDto) => request.recipients.filter(recipient => recipient.status === 'signed').length

function stateOf(recipient: SignRequestRecipientDto): string {
  if (recipient.status === 'signed' && recipient.signedAt) return t.signedOn(formatDateTime(recipient.signedAt))
  if (recipient.status === 'declined' && recipient.declinedAt) return t.declinedOn(formatDateTime(recipient.declinedAt))
  if (recipient.status === 'withdrawn' && recipient.withdrawnAt) return t.withdrawnOn(formatDateTime(recipient.withdrawnAt))
  return t.status.open
}
const BADGE: Record<SignRequestRecipientDto['status'], string> = {
  open: 'bg-amber-100 text-amber-900', signed: 'bg-green-100 text-green-800', declined: 'bg-red-100 text-red-800', withdrawn: 'bg-gray-100 text-gray-700',
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-600">{{ t.intro }} {{ t.howToSend }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <UAlert v-if="overdueCount" color="warning" variant="soft" icon="i-lucide-alarm-clock" :title="t.overdueNotice(overdueCount)" />
    <p v-if="status !== 'pending' && !requests.length && !error" class="text-sm text-gray-500">{{ t.none }}</p>

    <section v-for="request in requests" :key="request.id" class="space-y-2 rounded-lg bg-white p-4 ring-1" :class="request.overdue ? 'ring-amber-300' : 'ring-gray-200'">
      <div class="flex flex-wrap items-start gap-2">
        <div class="min-w-0 flex-1 space-y-0.5">
          <h3 class="font-semibold break-words">
            {{ request.title }}
            <span v-if="request.overdue" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-900">{{ t.overdue }}</span>
          </h3>
          <p class="text-sm text-gray-600">
            {{ t.sentOn(formatDate(todayIso(new Date(request.createdAt))), request.createdBy) }}
            <template v-if="request.dueDate"> · {{ t.dueOn(formatDate(request.dueDate)) }}</template>
            · {{ t.folderLabel(de.personnel.folders[request.targetFolder]) }} · {{ t.counts(signedOf(request), request.recipients.length) }}
          </p>
          <p v-if="request.note" class="whitespace-pre-line text-sm text-gray-700">{{ request.note }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <UButton :to="`/api/sign-requests/${request.id}/file`" target="_blank" external size="xs" color="neutral" variant="outline" icon="i-lucide-file-text" :label="t.viewFile" />
          <template v-if="openOf(request).length">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-bell" :label="t.remindAll" :disabled="busy" @click="remind(request, null)" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" :label="t.withdrawAll" :disabled="busy" @click="withdraw(request, null)" />
          </template>
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t.deleteRequest" :title="t.deleteRequest" :disabled="busy" @click="remove(request)" />
        </div>
      </div>
      <ul class="divide-y divide-gray-100">
        <li v-for="recipient in request.recipients" :key="recipient.id" class="flex flex-wrap items-center gap-2 py-2 text-sm">
          <span class="min-w-40 flex-1 font-medium">{{ recipient.name }}</span>
          <span class="rounded px-1.5 py-0.5 text-xs" :class="BADGE[recipient.status]">{{ t.status[recipient.status] }}</span>
          <span class="text-gray-600">{{ stateOf(recipient) }}</span>
          <span v-if="recipient.status === 'open' && recipient.remindedAt" class="text-xs text-gray-500">{{ t.remindedOn(formatDateTime(recipient.remindedAt)) }}</span>
          <span v-if="recipient.declineReason" class="w-full break-words text-gray-700">{{ t.reason(recipient.declineReason) }}</span>
          <span v-if="recipient.signedHash" class="font-mono text-xs text-gray-500" :title="t.hashTitle">{{ t.hash(recipient.signedHash) }}</span>
          <span v-if="recipient.copyModified" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800" :title="t.copyModifiedTitle">{{ t.copyModified }}</span>
          <span v-if="recipient.copyDeleted" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{{ t.copyDeleted }}</span>
          <!-- The type became „nur Einsicht vermerken“ after sending: the copy is unlinked and on the cleanup list (said in full). -->
          <span v-if="recipient.copyInspectionOnly" class="w-full rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">
            <strong>{{ t.copyInspectionOnly }}:</strong> {{ t.copyInspectionOnlyTitle }}
          </span>
          <UButton
            v-if="recipient.signedDocumentId" :to="employeeDocumentUrl(recipient.signedDocumentId)" target="_blank" external size="xs"
            color="neutral" variant="ghost" icon="i-lucide-external-link" :label="t.openCopy"
          />
          <template v-if="recipient.status === 'open'">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-bell" :label="t.remind" :aria-label="`${t.remind}: ${recipient.name}`" :disabled="busy" @click="remind(request, recipient)" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" :label="t.withdraw" :aria-label="`${t.withdraw}: ${recipient.name}`" :disabled="busy" @click="withdraw(request, recipient)" />
          </template>
        </li>
      </ul>
    </section>
  </div>
</template>
