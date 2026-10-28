<script setup lang="ts">
import {
  EMPLOYEE_DELETE_MODES, RETENTION_CASH_YEARS_RANGE, RETENTION_DEFAULTS, RETENTION_YEARS_RANGE, type RetentionSettings,
} from '#shared/domain/retention'
import { de } from '~/locales/de'

/**
 * Einstellungen → Personal → Löschfristen (per facility, „Einstellungen für“ applies): how long the data of left
 * employees is kept, who may delete a left employee by hand, and how long an archived cash box is kept. The Träger
 * changes them, the Leitung sees them read-only (the server checks as well).
 */
const t = de.retention
const { data, refresh } = await useFetch<RetentionSettings>('/api/retention-settings', { key: 'retention-settings' })
const { can } = useCan()
const canEditRetention = computed(() => can('settings.retention'))
const { busy, run } = useBusyAction(refresh)

const PERIODS = ['timeYears', 'assessmentYears', 'paidOvertimeYears', 'pensionYears'] as const
const form = reactive<RetentionSettings>({ ...RETENTION_DEFAULTS })
watch(data, (value) => { if (value) Object.assign(form, value) }, { immediate: true })
const modeItems = EMPLOYEE_DELETE_MODES.map(mode => ({ label: t.employeeDeleteModes[mode], value: mode }))

const dirty = useDirty(() => canEditRetention.value && !!data.value
  && (Object.keys(RETENTION_DEFAULTS) as (keyof RetentionSettings)[]).some(key => form[key] !== data.value![key]))
const save = () => dirty.value && run(() => $fetch<RetentionSettings>('/api/retention-settings', { method: 'PUT', body: { ...form } }), de.common.saved)
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p class="text-sm text-gray-600">{{ t.intro }}</p>
    <p v-if="!canEditRetention" class="text-xs text-gray-500">{{ t.providerOnly }}</p>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField v-for="period in PERIODS" :key="period" :label="t.periods[period]" :help="t.periodHelp[period]">
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="form[period]" type="number" :min="RETENTION_YEARS_RANGE.min" :max="RETENTION_YEARS_RANGE.max" step="1"
            required class="w-24" :disabled="!canEditRetention"
          />
          <span class="text-sm text-gray-600">{{ t.years }}</span>
        </div>
      </UFormField>
      <UFormField :label="t.employeeDelete" :help="t.employeeDeleteHelp">
        <USelect v-model="form.employeeDelete" :items="modeItems" class="w-56" :disabled="!canEditRetention" />
      </UFormField>
      <UFormField :label="t.cashYears" :help="t.cashYearsHelp">
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="form.cashYears" type="number" :min="RETENTION_CASH_YEARS_RANGE.min" :max="RETENTION_CASH_YEARS_RANGE.max" step="1"
            required class="w-24" :disabled="!canEditRetention"
          />
          <span class="text-sm text-gray-600">{{ t.years }}</span>
        </div>
      </UFormField>
      <UButton v-if="canEditRetention" type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
