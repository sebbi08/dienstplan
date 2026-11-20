<script setup lang="ts">
import { EVE_LEAVE_OPTIONS, type EveLeave, type LeaveCountingDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Dienstplan, below „Urlaubsanträge“ (per facility, „Einstellungen für“ applies): „Wir arbeiten nach
 * TVöD SuE“ (then 24 and 31 December are paid free, TVöD § 6 Abs. 3) and, without it, whether a leave day on those days
 * counts as a whole or half day or the days are paid free. The Träger changes it, the Leitung sees it read-only (the
 * server checks as well).
 */
const t = de.leaveCounting
const { data, refresh } = await useFetch<LeaveCountingDto>('/api/leave-counting', { key: 'leave-counting' })
const { can } = useCan()
const canConfigure = computed(() => can('leave.configure'))
const { busy, run } = useBusyAction(refresh)

const form = reactive<LeaveCountingDto>({ tvoedSue: true, eveLeave: 'whole' })
watch(data, (value) => { if (value) Object.assign(form, value) }, { immediate: true })
const items = EVE_LEAVE_OPTIONS.map(value => ({ label: t.options[value], value }))

const dirty = useDirty(() => canConfigure.value && !!data.value
  && (form.tvoedSue !== data.value.tvoedSue || form.eveLeave !== data.value.eveLeave))
const save = () => dirty.value && run(() => $fetch<LeaveCountingDto>('/api/leave-counting', {
  method: 'PUT', body: { tvoedSue: form.tvoedSue, eveLeave: form.eveLeave },
}), de.common.saved)
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p v-if="!canConfigure" class="text-xs text-gray-500">{{ t.providerOnly }}</p>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :help="t.tvoedHint">
        <USwitch v-model="form.tvoedSue" :label="t.tvoed" :disabled="!canConfigure" />
      </UFormField>
      <UFormField :label="t.label">
        <p v-if="form.tvoedSue" class="text-sm font-medium text-gray-800">{{ t.paidTvoed }}</p>
        <URadioGroup
          v-else :model-value="form.eveLeave" orientation="horizontal" :items="items" :disabled="!canConfigure"
          @update:model-value="form.eveLeave = $event as EveLeave"
        />
      </UFormField>
      <UButton v-if="canConfigure" type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
