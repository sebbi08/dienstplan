<script setup lang="ts">
import { addDays, todayIso } from '#shared/domain/dates'
import type { EmergencyConsentDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Whether the employee agreed that colleagues see their emergency contacts at the tablet (employee page, for Leitung
 * and Träger). A consent the employee gave in the app is shown read-only (only they withdraw it); otherwise the Leitung
 * record a written declaration with its day. After the employee's own withdrawal only a later day counts.
 */
const props = defineProps<{ employeeId: number }>()
const url = `/api/employees/${props.employeeId}/emergency-consent`
const { data: consent, refresh } = await useFetch<EmergencyConsentDto>(url)
const { busy, run } = useBusyAction(() => refresh())
const t = de.staffEmergency

const written = ref(false)
const date = ref('')
const today = todayIso()
const minDate = computed(() => (consent.value?.earliestWrittenDate ? addDays(consent.value.earliestWrittenDate, 1) : undefined))

async function save() {
  if (!date.value) return
  if (await run(() => $fetch<unknown>(url, { method: 'PUT', body: { consent: true, date: date.value } }), de.common.saved)) {
    written.value = false
    date.value = ''
  }
}
function withdraw() {
  run(() => $fetch<unknown>(url, { method: 'PUT', body: { consent: false } }), de.common.saved)
}
</script>

<template>
  <div v-if="consent" class="space-y-2 rounded-md bg-gray-50 p-3 text-sm">
    <h3 class="font-medium">{{ t.consentTitle }}</h3>
    <p class="text-gray-500">{{ t.consentHint }}</p>

    <template v-if="consent.consent && consent.selfOnly">
      <p class="font-medium text-green-700">{{ t.givenSelf(formatDate(consent.date!)) }}</p>
      <p class="text-gray-500">{{ t.givenSelfHint }}</p>
    </template>
    <template v-else-if="consent.consent">
      <p class="font-medium text-green-700">{{ t.givenWritten(formatDate(consent.date!)) }}</p>
      <UButton size="xs" color="neutral" variant="outline" :label="t.withdraw" :disabled="busy" @click="withdraw" />
    </template>
    <template v-else>
      <p class="text-gray-600">{{ t.noConsent }}</p>
      <p v-if="consent.earliestWrittenDate" class="text-amber-800">{{ t.withdrawnSelf(formatDate(consent.earliestWrittenDate)) }}</p>
      <UCheckbox v-model="written" :label="t.writtenLabel" />
      <form v-if="written" class="flex flex-wrap items-end gap-2" @submit.prevent="save">
        <UFormField :label="t.writtenDate">
          <DateTextInput v-model="date" :min="minDate" :max="today" :label="t.writtenDate" required />
        </UFormField>
        <UButton type="submit" size="sm" :label="t.save" :loading="busy" :disabled="busy || !date" />
      </form>
    </template>
  </div>
</template>
