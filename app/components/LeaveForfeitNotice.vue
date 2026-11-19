<script setup lang="ts">
import type { MyLeaveForfeitDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * The notice on remaining leave for the signed-in employee („Mein Urlaub“ and the start page): from 1 October until
 * the forfeiture date in the year after, while leave of the year is left; „Gelesen“ stores a receipt and hides it for
 * the year (server/services/leaveForfeit.ts). Nothing for an account without an employee.
 */
const { user } = useUserSession()
const { data, refresh } = await useFetch<MyLeaveForfeitDto>('/api/my/leave-forfeit', {
  key: 'leave-forfeit-notice', immediate: user.value?.employeeId != null,
})
const { busy, run } = useBusyAction(refresh)

function markRead() {
  const notice = data.value?.notice
  if (!notice) return
  run(() => $fetch<{ readAt: string }>('/api/my/leave-forfeit/read', { method: 'POST', body: { year: notice.year } }), de.leaveForfeit.readDone)
}
</script>

<template>
  <!-- Never on paper: a plan printed straight from the browser may end up on the wall. -->
  <UAlert
    v-if="data?.notice" class="print:hidden" color="warning" variant="soft" icon="i-lucide-calendar-clock"
    :title="de.leaveForfeit.noticeTitle"
  >
    <template #description>
      <p>{{ data.notice.text }}</p>
      <UButton class="mt-2" size="sm" color="warning" icon="i-lucide-check" :label="de.leaveForfeit.read" :loading="busy" :disabled="busy" @click="markRead" />
    </template>
  </UAlert>
</template>
