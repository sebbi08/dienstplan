<script setup lang="ts">
import type { EmployeePayrollDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import {
  MASKED_PAYROLL, fieldErrorOf, formatIban, payrollDisplay, payrollFieldsOf, payrollFormChanged, payrollInput,
  type FieldErrorCode, type PayrollFields, type PayrollKey,
} from '~/utils/personnel'

/**
 * „Lohn und Steuer“ in the tab „Vertrag & Lohn“ (employees.payroll; the page mounts it only then). The values are
 * fetched in the browser and only once the tab is opened, so they never stand in the page source; Steuer-ID, Steuerklasse, SV-Nummer, IBAN and
 * Konfession show masked until „anzeigen“ (hidden again when the tab is left). „Bearbeiten“ opens the form; format errors (checked
 * here and again by the server) stand at their field.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.personnel.payroll
const url = `/api/employees/${props.employeeId}/payroll`
const { data: payroll, status, error, execute, refresh } = useFetch<EmployeePayrollDto>(url, { server: false, immediate: false })
const { busy, run } = useBusyAction(() => refresh())

const KEYS: PayrollKey[] = ['taxId', 'taxClass', 'svNumber', 'healthInsurer', 'iban', 'accountHolder', 'denomination']
const revealed = reactive<Partial<Record<PayrollKey, boolean>>>({})
const hideAll = () => { for (const key of KEYS) revealed[key] = false }
const editing = ref(false)

onMounted(() => {
  watch(() => props.active, (active) => {
    if (active && status.value === 'idle') void execute()
    if (!active) {
      hideAll()
      editing.value = false
    }
  }, { immediate: true })
})

const maskable = computed(() => MASKED_PAYROLL.filter(key => payroll.value?.[key]))
const allShown = computed(() => maskable.value.length > 0 && maskable.value.every(key => revealed[key]))
const isEmpty = computed(() => !payroll.value || KEYS.every(key => payroll.value?.[key] === null))
function toggleAll() {
  const next = !allShown.value
  for (const key of maskable.value) revealed[key] = next
}

const form = reactive<PayrollFields>(payrollFieldsOf(null))
const fieldErrors = ref<Record<string, FieldErrorCode>>({})
const fieldError = (key: string) => (fieldErrors.value[key] ? de.errors[fieldErrors.value[key]] : undefined)
// An open form with changes makes the page ask before another tab or page; after a confirmed switch the form closes.
useDirty(() => editing.value && payrollFormChanged(form, payroll.value))
const taxClassItems = [{ label: t.taxClassNone, value: 0 }, ...[1, 2, 3, 4, 5, 6].map(value => ({ label: String(value), value }))]

function startEdit() {
  Object.assign(form, payrollFieldsOf(payroll.value))
  fieldErrors.value = {}
  editing.value = true
}

async function save() {
  const input = payrollInput(form)
  if ('errors' in input) return void (fieldErrors.value = input.errors)
  fieldErrors.value = {}
  const ok = await run(async () => {
    try {
      await $fetch<unknown>(url, { method: 'PUT', body: input.value })
    }
    catch (failure) {
      fieldErrors.value = fieldErrorOf(errorCode(failure))
      throw failure
    }
  }, de.common.saved)
  if (ok) {
    editing.value = false
    hideAll()
  }
}

const loadError = computed(() => (error.value ? errorMessage(error.value) : null))
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ t.title }}</h2>
      <div v-if="payroll && !editing" class="ml-auto flex flex-wrap gap-2">
        <UButton
          v-if="maskable.length" size="xs" color="neutral" variant="outline" :icon="allShown ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :label="allShown ? t.hideAll : t.showAll" @click="toggleAll"
        />
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" :label="de.common.edit" @click="startEdit" />
      </div>
    </div>
    <p class="text-sm text-gray-500">{{ t.hint }}</p>

    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
    <p v-else-if="!payroll" class="text-sm text-gray-500">{{ t.loading }}</p>

    <template v-else-if="!editing">
      <p v-if="isEmpty" class="text-sm text-gray-500">{{ t.none }}</p>
      <dl v-else class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
        <template v-for="key in KEYS" :key="key">
          <dt class="text-gray-500">{{ t[key] }}</dt>
          <dd class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span :class="key === 'iban' || key === 'taxId' || key === 'svNumber' ? 'font-mono tabular-nums break-all' : ''">
              {{ payrollDisplay(payroll, key, revealed[key] === true) ?? t.empty }}
            </span>
            <UButton
              v-if="maskable.includes(key)" size="xs" color="neutral" variant="ghost"
              :icon="revealed[key] ? 'i-lucide-eye-off' : 'i-lucide-eye'" :label="revealed[key] ? t.hide : t.show"
              :aria-label="revealed[key] ? t.hideValue(t[key]) : t.showValue(t[key])" @click="revealed[key] = !revealed[key]"
            />
          </dd>
        </template>
      </dl>
    </template>

    <form v-else class="grid gap-3 sm:grid-cols-2" autocomplete="off" @submit.prevent="save">
      <UFormField :label="t.taxId" :error="fieldError('taxId')">
        <UInput v-model="form.taxId" inputmode="numeric" maxlength="30" :placeholder="t.taxIdPlaceholder" class="w-full" />
      </UFormField>
      <UFormField :label="t.taxClass" :error="fieldError('taxClass')">
        <USelect v-model="form.taxClass" :items="taxClassItems" class="w-full sm:w-32" />
      </UFormField>
      <UFormField :label="t.svNumber" :error="fieldError('svNumber')">
        <UInput v-model="form.svNumber" maxlength="30" :placeholder="t.svNumberPlaceholder" class="w-full" />
      </UFormField>
      <UFormField :label="t.healthInsurer">
        <UInput v-model="form.healthInsurer" maxlength="100" class="w-full" />
      </UFormField>
      <UFormField :label="t.iban" :error="fieldError('iban')">
        <UInput v-model="form.iban" maxlength="50" :placeholder="t.ibanPlaceholder" class="w-full font-mono" @blur="form.iban = formatIban(form.iban)" />
      </UFormField>
      <UFormField :label="t.accountHolder">
        <UInput v-model="form.accountHolder" maxlength="100" class="w-full" />
      </UFormField>
      <UFormField :label="t.denomination">
        <UInput v-model="form.denomination" maxlength="50" class="w-full" />
      </UFormField>
      <p class="text-xs text-gray-500 sm:col-span-2">{{ t.formatHint }}</p>
      <div class="flex flex-wrap gap-2 sm:col-span-2">
        <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
        <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="editing = false" />
      </div>
    </form>
  </section>
</template>
