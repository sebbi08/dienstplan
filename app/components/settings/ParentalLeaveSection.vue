<script setup lang="ts">
import type { ParentalLeaveSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Mitarbeitende → „Elternzeit im Dienstplan“ (per facility, „Einstellungen für“ applies): „Elternzeit für alle
 * sichtbar anzeigen“. Off (the default), only viewers with employees.view see „Elternzeit“ in the plan, everybody else and
 * the tablet „abwesend“. Shown with employees.contractView, changed with employees.contractEdit (the server checks too).
 */
const t = de.parentalLeave.settings
const { data, refresh } = await useFetch<ParentalLeaveSettingsDto>('/api/parental-leave-settings', { key: 'parental-leave-settings' })
const { busy, run } = useBusyAction(refresh)

async function change(value: boolean) {
  await run(() => $fetch<ParentalLeaveSettingsDto>('/api/parental-leave-settings', { method: 'PUT', body: { visibleToAll: value } }), t.saved)
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <USwitch
      v-if="data" :model-value="data.visibleToAll" :label="t.visibleToAll" :disabled="busy || !data.canEdit"
      @update:model-value="change($event)"
    />
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
