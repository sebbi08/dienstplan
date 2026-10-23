<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { AppSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Einstellungen → Zeiterfassung: from which day the stamped time counts, below the tolerance of the late / early marks. */
const { data: appSettings, refresh } = await useFetch<AppSettingsDto>('/api/app-settings')
const confirm = useConfirm()
const { busy, run } = useBusyAction(refresh)
const trackingFrom = ref('')
watch(appSettings, value => (trackingFrom.value = value?.timeTrackingFrom ?? ''), { immediate: true })
const dirty = useDirty(() => !!appSettings.value && trackingFrom.value !== (appSettings.value.timeTrackingFrom ?? ''))

async function save() {
  if (!dirty.value) return
  // A start date in the past turns all workdays since then into "stamped time only" (0 h without stamps).
  const date = trackingFrom.value
  if (date && date < todayIso() && date !== appSettings.value?.timeTrackingFrom
    && !await confirm(de.settings.timeTrackingPastConfirm, { confirmLabel: de.common.save, danger: false })) return
  run(() => $fetch<unknown>('/api/app-settings', { method: 'PUT', body: { timeTrackingFrom: trackingFrom.value || null } }), de.common.saved)
}
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settings.timeTracking }}</h2>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="save">
      <UFormField :label="de.settings.timeTrackingFrom"><UInput v-model="trackingFrom" type="date" /></UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ de.settings.timeTrackingHint }}</p>
    <SettingsTimeMarksForm />
  </section>
</template>
