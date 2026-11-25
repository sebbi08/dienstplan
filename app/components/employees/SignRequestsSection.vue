<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { openSignItemsOf } from '~/utils/signRequestsOpen'

/**
 * „Noch zu unterschreiben“ on the person's tab „Nachweise“ (signRequests.manage, mounted only with it): the requests the
 * person still has to sign that the viewer sees (as in Mitarbeitende → Unterschriften), with the due date, the overdue
 * ones in red, „Erinnern“ and „Zurückziehen“. Loaded once the tab is opened; nothing shows while nothing is open.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.signRequests
const { data, error, execute, refresh, status } = useSignRequests({ immediate: false })
// In the browser only, each time the tab is opened (as the other sections of the page load).
onMounted(() => watch(() => props.active, (active) => {
  if (active) void (status.value === 'idle' ? execute() : refresh())
}, { immediate: true }))
const items = computed(() => openSignItemsOf(data.value ?? [], props.employeeId, todayIso()))
const { busy, remind, withdraw } = useSignRequestActions()
</script>

<template>
  <section
    v-if="items.length" class="space-y-2 rounded-lg bg-white p-4 ring-1" :class="items.some(item => item.overdue) ? 'ring-red-300' : 'ring-gray-200'"
    aria-labelledby="employee-sign-title"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h2 id="employee-sign-title" class="text-lg font-semibold">{{ t.personTitle }}</h2>
      <UButton class="ml-auto" size="xs" color="neutral" variant="ghost" icon="i-lucide-signature" :label="t.allRequests" to="/admin/employees/signatures" />
    </div>
    <p class="text-sm text-gray-600">{{ t.personIntro }}</p>
    <ul class="divide-y divide-gray-100">
      <li v-for="item in items" :key="item.recipient.id" class="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
        <div class="min-w-0 flex-1 basis-56">
          <p class="break-words font-medium" :class="item.overdue ? 'text-red-700' : ''">
            {{ item.request.title }}
            <span v-if="item.overdue" class="ml-1 rounded bg-red-100 px-1.5 py-0.5 align-middle text-xs font-medium text-red-800">{{ t.overdue }}</span>
          </p>
          <p class="text-gray-600">
            {{ t.sentOn(formatDate(todayIso(new Date(item.request.createdAt))), item.request.createdBy) }}
            <template v-if="item.request.dueDate"> · <span :class="item.overdue ? 'font-medium text-red-700' : ''">{{ t.dueOn(formatDate(item.request.dueDate)) }}</span></template>
            <template v-if="item.recipient.remindedAt"> · {{ t.remindedOn(formatDateTime(item.recipient.remindedAt)) }}</template>
          </p>
        </div>
        <UButton :to="`/api/sign-requests/${item.request.id}/file`" target="_blank" external size="xs" color="neutral" variant="outline" icon="i-lucide-file-text" :label="t.viewFile" />
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-bell" :label="t.remind" :aria-label="`${t.remind}: ${item.request.title}`" :disabled="busy" @click="remind(item.request, item.recipient)" />
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" :label="t.withdraw" :aria-label="`${t.withdraw}: ${item.request.title}`" :disabled="busy" @click="withdraw(item.request, item.recipient)" />
      </li>
    </ul>
  </section>
  <UAlert v-else-if="error && active" color="warning" variant="soft" :title="`${t.personTitle}: ${errorMessage(error)}`" />
</template>
