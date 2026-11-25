<script setup lang="ts">
import {
  APPLICANT_MONTHS_RANGE, EMPLOYEE_DELETE_MODES, INFO_VISIT_MONTHS_RANGE, OPEN_APPLICANT_MONTHS_RANGE, PAID_OVERTIME_MIN_YEARS,
  RETENTION_CASH_YEARS_RANGE,
  RETENTION_DEFAULTS, RETENTION_YEARS_RANGE, type RetentionSettings,
} from '#shared/domain/retention'
import { de } from '~/locales/de'

/**
 * Einstellungen → Personal → Löschfristen (per facility, „Einstellungen für“ applies): how long the data of left
 * employees is kept (Lohn und Steuer by „Lohnunterlagen bewahrt ein Lohnbüro auf“), who may delete a left employee by
 * hand, and how long an archived cash box is kept. The Träger
 * changes them, the Leitung sees them read-only (the server checks as well).
 */
const t = de.retention
const { data, refresh } = await useFetch<RetentionSettings>('/api/retention-settings', { key: 'retention-settings' })
const { can } = useCan()
const canEditRetention = computed(() => can('settings.retention'))
const { busy, run } = useBusyAction(refresh)

const PERIODS = ['timeYears', 'assessmentYears', 'paidOvertimeYears', 'pensionYears', 'bemYears', 'maternityYears'] as const
const form = reactive<RetentionSettings>({ ...RETENTION_DEFAULTS })
watch(data, (value) => { if (value) Object.assign(form, value) }, { immediate: true })
const modeItems = EMPLOYEE_DELETE_MODES.map(mode => ({ label: t.employeeDeleteModes[mode], value: mode }))
// „Ausgezahlte Überstunden“: at least 8 years (Buchungsbelege); a lower value stored before stays allowed, counts as 8.
const belowMinimum = computed(() => !!data.value && data.value.paidOvertimeYears < PAID_OVERTIME_MIN_YEARS)
const minYears = (period: (typeof PERIODS)[number]) => (period === 'paidOvertimeYears'
  ? Math.min(PAID_OVERTIME_MIN_YEARS, data.value?.paidOvertimeYears ?? PAID_OVERTIME_MIN_YEARS)
  : RETENTION_YEARS_RANGE.min)

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
            v-model.number="form[period]" type="number" :min="minYears(period)" :max="RETENTION_YEARS_RANGE.max" step="1"
            required class="w-24" :disabled="!canEditRetention"
          />
          <span class="text-sm text-gray-600">{{ t.years }}</span>
        </div>
        <p v-if="period === 'paidOvertimeYears' && belowMinimum" class="mt-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {{ t.paidOvertimeBelowMinimum(data!.paidOvertimeYears) }}
        </p>
      </UFormField>
      <UFormField :help="t.payrollOfficeHelp">
        <UCheckbox v-model="form.payrollOffice" :label="t.payrollOffice" :disabled="!canEditRetention" />
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
      <UFormField :label="t.infoVisitMonths" :help="t.infoVisitMonthsHelp">
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="form.infoVisitMonths" type="number" :min="INFO_VISIT_MONTHS_RANGE.min" :max="INFO_VISIT_MONTHS_RANGE.max" step="1"
            required class="w-24" :disabled="!canEditRetention"
          />
          <span class="text-sm text-gray-600">{{ t.months }}</span>
        </div>
      </UFormField>
      <UFormField :label="t.applicantMonths" :help="t.applicantMonthsHelp">
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="form.applicantMonths" type="number" :min="APPLICANT_MONTHS_RANGE.min" :max="APPLICANT_MONTHS_RANGE.max" step="1"
            required class="w-24" :disabled="!canEditRetention"
          />
          <span class="text-sm text-gray-600">{{ t.months }}</span>
        </div>
      </UFormField>
      <UFormField :label="t.openApplicantMonths" :help="t.openApplicantMonthsHelp">
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="form.openApplicantMonths" type="number" :min="OPEN_APPLICANT_MONTHS_RANGE.min" :max="OPEN_APPLICANT_MONTHS_RANGE.max"
            step="1" required class="w-24" :disabled="!canEditRetention"
          />
          <span class="text-sm text-gray-600">{{ t.months }}</span>
        </div>
      </UFormField>
      <UButton v-if="canEditRetention" type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
