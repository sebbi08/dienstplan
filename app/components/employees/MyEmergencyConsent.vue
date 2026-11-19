<script setup lang="ts">
import type { EmergencyConsentDto, TabletStaffEmergencyDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { telHref } from '~/utils/children'

/**
 * „Meins“: the employee's own switch for showing their emergency contacts to colleagues at the facility tablet, with the
 * contacts that would be shown (read-only, as colleagues would see them: no note). Only the employee themselves set it
 * here (the API takes the employee from the session). The switch takes effect at once.
 */
const { data: consent, error, refresh } = await useFetch<EmergencyConsentDto>('/api/my/emergency-consent')
const { data: contacts } = await useFetch<TabletStaffEmergencyDto['contacts']>('/api/my/emergency-contacts')
const { busy, run } = useBusyAction(() => refresh())
const t = de.staffEmergency

function toggle(next: boolean) {
  run(() => $fetch<unknown>('/api/my/emergency-consent', { method: 'PUT', body: { consent: next } }), de.common.saved)
}
const phones = (contact: TabletStaffEmergencyDto['contacts'][number]) => [contact.phone, contact.phone2].filter(number => number !== '')
</script>

<template>
  <section v-if="consent && !error" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.myTitle }}</h2>
    <USwitch :model-value="consent.consent" :label="t.myLabel" :disabled="busy" @update:model-value="toggle($event)" />
    <p class="text-sm text-gray-500">{{ t.myHint }}</p>
    <div class="rounded-md bg-gray-50 p-3 text-sm">
      <p class="mb-1 font-medium">{{ t.myContactsTitle }}</p>
      <p v-if="!contacts?.length" class="text-amber-800">{{ t.myContactsNone }}</p>
      <ol v-else class="space-y-1">
        <li v-for="(contact, index) in contacts" :key="index" class="flex flex-wrap gap-x-3">
          <span>{{ contact.name }}<span v-if="contact.relation" class="text-gray-600"> ({{ contact.relation }})</span></span>
          <a v-for="number in phones(contact)" :key="number" :href="telHref(number)" class="text-sky-700 hover:underline">{{ number }}</a>
        </li>
      </ol>
    </div>
  </section>
</template>
