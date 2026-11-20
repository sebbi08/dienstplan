<script setup lang="ts">
import { eveModeIn, eveRuleOf } from '#shared/domain/eveRules'
import { EVE_LEAVE_OPTIONS, type EveLeave, type LeaveCountingDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Dienstplan, below „Urlaubsanträge“ (per facility, „Einstellungen für“ applies): „Wir arbeiten nach
 * TVöD SuE“ (then 24 and 31 December are paid free, TVöD § 6 Abs. 3) and, without it, whether a leave day on those days
 * counts as a whole or half day or the days are paid free. A change applies from the effective year (this year until
 * 23 December, then the next); earlier years keep their rule, which the hint names. The Träger changes it, the Leitung
 * sees it read-only (the server checks as well).
 */
const t = de.leaveCounting
const { data, refresh } = await useFetch<LeaveCountingDto>('/api/leave-counting', { key: 'leave-counting' })
const { can } = useCan()
const canConfigure = computed(() => can('leave.configure'))
const { busy, run } = useBusyAction(refresh)

const form = reactive({ tvoedSue: true, eveLeave: 'whole' as EveLeave })
watch(data, (value) => {
  if (value) Object.assign(form, { tvoedSue: value.tvoedSue, eveLeave: value.eveLeave })
}, { immediate: true })
const items = EVE_LEAVE_OPTIONS.map(value => ({ label: t.options[value], value }))

const dirty = useDirty(() => canConfigure.value && !!data.value
  && (form.tvoedSue !== data.value.tvoedSue || form.eveLeave !== data.value.eveLeave))

/**
 * „gilt ab ‹Jahr›“: the first year of the rule in force; while changing, the effective year the save applies from,
 * unless the years before already count so (then nothing changes and the server writes no entry). None for a rule since
 * always. `before`: the rule of the year before it („bis 2025: ganzer Urlaubstag“).
 */
const validity = computed(() => {
  if (!data.value) return null
  const { effectiveYear, rules } = data.value
  const mode = form.tvoedSue ? 'paid' : form.eveLeave
  const unchangedBefore = eveModeIn(rules, effectiveYear - 1) === mode
  const fromYear = dirty.value && !unchangedBefore
    ? effectiveYear
    : eveRuleOf(rules, dirty.value ? effectiveYear - 1 : effectiveYear)?.fromYear ?? 0
  if (fromYear <= 0) return null
  return { fromYear, before: t.before(fromYear - 1, t.options[eveModeIn(rules, fromYear - 1)]) }
})

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
          <UBadge v-if="validity && form.tvoedSue" size="sm" variant="soft" color="info" :label="t.validFrom(validity.fromYear)" />
        </div>
      </UFormField>
      <UFormField :label="t.label">
        <p v-if="form.tvoedSue" class="text-sm font-medium text-gray-800">{{ t.paidTvoed }}</p>
        <div v-else class="flex flex-wrap items-center gap-2">
          <URadioGroup
            :model-value="form.eveLeave" orientation="horizontal" :items="items" :disabled="!canConfigure"
            @update:model-value="form.eveLeave = $event as EveLeave"
          />
          <UBadge v-if="validity" size="sm" variant="soft" color="info" :label="t.validFrom(validity.fromYear)" />
        </div>
        <p v-if="validity" class="mt-1 text-xs text-gray-500">{{ validity.before }} {{ t.pastUnchanged }}</p>
      </UFormField>
      <UButton v-if="canConfigure" type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
