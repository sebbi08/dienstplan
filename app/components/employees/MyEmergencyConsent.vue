<script setup lang="ts">
import type { EmergencyConsentDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Meins“: the employee's own switch for showing their emergency contacts to colleagues at the facility tablet. Only the
 * employee themselves set it here (the API takes the employee from the session). The switch takes effect at once.
 */
const { data: consent, error, refresh } = await useFetch<EmergencyConsentDto>('/api/my/emergency-consent')
const { busy, run } = useBusyAction(() => refresh())
const t = de.staffEmergency

function toggle(next: boolean) {
  run(() => $fetch<unknown>('/api/my/emergency-consent', { method: 'PUT', body: { consent: next } }), de.common.saved)
}
</script>

<template>
  <section v-if="consent && !error" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <USwitch :model-value="consent.consent" :label="t.myLabel" :disabled="busy" @update:model-value="toggle($event)" />
    <p class="text-sm text-gray-500">{{ t.myHint }}</p>
  </section>
</template>
