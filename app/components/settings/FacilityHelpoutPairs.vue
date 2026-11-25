<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import type { FacilityDto, HelpoutPairsDto, PairedHelpOutDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'
import { pairedWith } from '~/utils/helpoutPairs'

/**
 * „Gegenseitige Aushilfe mit:“ in a facility card: the Träger ticks the other facilities whose staff may help out here
 * and the other way round (one pair for both, so the tick shows in the other card too); ending a pair with planned
 * help-outs lists them first (they stay, marked „nicht freigegeben“). The Leitung sees the own facility's pairs.
 */
const props = defineProps<{
  facilityId: number
  facilities: FacilityDto[]
  pairs: HelpoutPairsDto | null
  manages: boolean
  refresh: () => Promise<unknown>
}>()
const t = de.helpoutPairs
const { busy, run } = useBusyAction(props.refresh)
const ask = useConfirm()
const toast = useToast()

const others = computed(() => props.facilities.filter(facility => facility.id !== props.facilityId))
const paired = computed(() => pairedWith(props.pairs, props.facilityId))
// The Leitung knows only her own facility: the names come with the pairs.
const pairedNames = computed(() => [...paired.value].map(id => props.pairs?.names[id] ?? '').sort((a, b) => a.localeCompare(b, 'de')))

/** At most this many planned help-outs are named when a pair is ended. */
const LISTED = 8

async function setPair(other: FacilityDto, value: boolean) {
  if (!value) {
    let planned: PairedHelpOutDto[]
    try {
      planned = await $fetch<PairedHelpOutDto[]>('/api/helpout-pairs/help-outs', { query: { facilityId: props.facilityId, otherFacilityId: other.id } })
    }
    catch {
      return void toast.add({ title: de.errors.generic, color: 'error' })
    }
    if (planned.length > 0) {
      const named = planned.slice(0, LISTED).map(entry => t.entry(formatDayShort(entry.date, weekday(entry.date)), entry.employee, entry.inFacility))
      if (!await ask(t.removeConfirm(other.name, named, planned.length - named.length), { confirmLabel: t.removeAction })) return
    }
  }
  await run(() => $fetch<{ ok: boolean }>('/api/helpout-pairs', {
    method: 'PUT', body: { facilityId: props.facilityId, otherFacilityId: other.id, paired: value },
  }), de.common.saved)
}
</script>

<template>
  <div class="space-y-2">
    <h4 class="text-sm font-semibold text-gray-700">{{ t.title }}</h4>
    <p v-if="manages && !others.length" class="text-xs text-gray-500">{{ t.noOthers }}</p>
    <div v-else-if="manages" class="flex flex-wrap gap-x-5 gap-y-1">
      <UCheckbox
        v-for="other in others" :key="other.id" :label="other.name" class="min-h-10 items-center" :disabled="busy || !pairs"
        :model-value="paired.has(other.id)" @update:model-value="value => setPair(other, value === true)"
      />
    </div>
    <template v-else>
      <p class="text-sm">{{ pairedNames.length ? pairedNames.join(', ') : t.none }}</p>
      <p class="text-xs text-gray-500">{{ t.readOnly }}</p>
    </template>
  </div>
</template>
