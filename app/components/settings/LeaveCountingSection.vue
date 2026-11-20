<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
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

const form = reactive<LeaveCountingDto>({ tvoedSue: true, eveLeave: 'whole', paidEvesFromYear: null })
watch(data, (value) => { if (value) Object.assign(form, value) }, { immediate: true })
const items = EVE_LEAVE_OPTIONS.map(value => ({ label: t.options[value], value }))

/**
 * „gilt ab ‹Jahr›“ while the form makes the two days paid free: the stored first year, or the current year when they
 * become paid free with this save (the server sets it so; earlier years keep the whole or half leave day).
 */
const paidFrom = computed(() => (form.tvoedSue || form.eveLeave === 'paid')
  ? data.value?.paidEvesFromYear ?? parseIsoDate(todayIso()).year
  : null)

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
        <div class="flex flex-wrap items-center gap-2">
          <USwitch v-model="form.tvoedSue" :label="t.tvoed" :disabled="!canConfigure" />
          <UBadge v-if="form.tvoedSue && paidFrom !== null" size="sm" variant="soft" color="info" :label="t.paidFrom(paidFrom)" />
        </div>
      </UFormField>
      <UFormField :label="t.label">
        <p v-if="form.tvoedSue" class="text-sm font-medium text-gray-800">{{ t.paidTvoed }}</p>
        <URadioGroup
          v-else :model-value="form.eveLeave" orientation="horizontal" :items="items" :disabled="!canConfigure"
          @update:model-value="form.eveLeave = $event as EveLeave"
        />
        <p v-if="!form.tvoedSue && paidFrom !== null" class="mt-1 text-sm font-medium text-gray-800">{{ t.paidFrom(paidFrom) }}</p>
        <p v-if="paidFrom !== null" class="mt-1 text-xs text-gray-500">{{ t.paidFromHint(paidFrom) }}</p>
      </UFormField>
      <UButton v-if="canConfigure" type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
