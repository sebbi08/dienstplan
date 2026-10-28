<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { JOB_KEYS, levelBySeniority, PAY_GROUPS, SUGGESTED_PAY_GROUP, type JobKey, type PayGroup } from '#shared/domain/tvoed'
import type { EmployeeContractDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { contractSummary } from '~/utils/contract'

/** Contract data of one employee (TVöD SuE): editable by the Träger, read-only for the Leitung when shared. */
const props = defineProps<{ employeeId: number; contract: EmployeeContractDto; editable: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const run = useAction(async () => emit('saved'))

const form = reactive<EmployeeContractDto>({
  personnelNumber: null, employedSince: null, jobKey: null, jobOther: null, payGroup: null, payLevel: null, fixedTermUntil: null,
})
watch(() => props.contract, value => Object.assign(form, value), { immediate: true })

const jobItems = [{ label: de.contract.none, value: null }, ...JOB_KEYS.map(key => ({ label: de.contract.jobs[key], value: key }))]
const groupItems = [{ label: de.contract.none, value: null }, ...PAY_GROUPS.map(group => ({ label: group, value: group }))]
const levelItems = [{ label: de.contract.none, value: null }, ...[1, 2, 3, 4, 5, 6].map(level => ({ label: String(level), value: level }))]

/** Choosing a job proposes its usual pay group (only while none is chosen or the old one was the proposal). */
function onJob(key: JobKey | null) {
  const previous = form.jobKey ? SUGGESTED_PAY_GROUP[form.jobKey] : null
  form.jobKey = key
  const suggested = key ? SUGGESTED_PAY_GROUP[key] : null
  if (suggested && (form.payGroup === null || form.payGroup === previous)) form.payGroup = suggested
}

const levelHint = computed(() => {
  if (!form.employedSince) return null
  const { level, nextLevel, nextOn } = levelBySeniority(form.employedSince, todayIso())
  return de.contract.levelHint(level, nextLevel, nextOn ? formatDate(nextOn) : null)
})

function useSuggestedLevel() {
  if (form.employedSince) form.payLevel = levelBySeniority(form.employedSince, todayIso()).level
}

function save() {
  run(() => $fetch<unknown>(`/api/employees/${props.employeeId}/contract`, {
    method: 'PUT',
    body: { ...form, employedSince: form.employedSince || null, fixedTermUntil: form.fixedTermUntil || null, payGroup: form.payGroup as PayGroup | null },
  }), de.common.saved)
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.contract.title }}</h2>
    <p v-if="!editable" class="text-sm">{{ contractSummary(contract, todayIso()) || de.contract.empty }}</p>
    <form v-else class="grid gap-3 sm:grid-cols-4 sm:items-start" @submit.prevent="save">
      <UFormField :label="de.contract.personnelNumber">
        <UInput :model-value="form.personnelNumber ?? ''" maxlength="30" class="w-full" @update:model-value="form.personnelNumber = String($event) || null" />
      </UFormField>
      <UFormField :label="de.contract.employedSince">
        <DateTextInput :model-value="form.employedSince ?? ''" :label="de.contract.employedSince" class="w-full" @update:model-value="form.employedSince = $event || null" />
      </UFormField>
      <UFormField :label="de.contract.job" class="sm:col-span-2">
        <USelect :model-value="form.jobKey" :items="jobItems" class="w-full" @update:model-value="onJob($event as JobKey | null)" />
      </UFormField>
      <UFormField v-if="form.jobKey === 'other'" :label="de.contract.jobOther">
        <UInput :model-value="form.jobOther ?? ''" maxlength="100" class="w-full" @update:model-value="form.jobOther = String($event) || null" />
      </UFormField>
      <UFormField :label="de.contract.payGroup" class="sm:col-start-1">
        <USelect v-model="form.payGroup" :items="groupItems" class="w-full" />
      </UFormField>
      <UFormField :label="de.contract.payLevel">
        <USelect v-model="form.payLevel" :items="levelItems" class="w-full" />
      </UFormField>
      <div v-if="levelHint" class="space-y-1 text-xs text-gray-600 sm:col-span-2 sm:pt-6">
        <p>{{ levelHint }}</p>
        <UButton size="xs" color="neutral" variant="outline" :label="de.contract.useLevel" @click="useSuggestedLevel" />
      </div>
      <UFormField :label="de.contract.fixedTermUntil" :help="de.contract.fixedTermUntilHint" class="sm:col-span-2 sm:col-start-1">
        <DateTextInput :model-value="form.fixedTermUntil ?? ''" :label="de.contract.fixedTermUntil" class="w-full sm:w-44" @update:model-value="form.fixedTermUntil = $event || null" />
      </UFormField>
      <p class="text-xs text-gray-500 sm:col-span-4">{{ de.contract.hint }}</p>
      <div class="sm:col-span-4"><UButton type="submit" :label="de.common.save" /></div>
    </form>
  </section>
</template>
