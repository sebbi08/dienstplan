<script setup lang="ts">
import type { ChildRecordDto, SchoolDistrictMatchDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { matchText } from '~/utils/schoolDistricts'

/**
 * The child's school district by the facility's street list, computed from the address on every load (never stored).
 * When the district has a school of the address book and the child no „künftige Schule“ yet, whoever may edit the
 * record can take it over with one click („Übernehmen“) – it is never set without that.
 */
const props = defineProps<{ child: ChildRecordDto; match: SchoolDistrictMatchDto; reload?: () => Promise<unknown> }>()
const t = de.schoolDistricts.record
const shown = computed(() => matchText(props.match))
const adoptable = computed(() => props.match.status === 'match' && props.match.canAdopt && props.child.canEdit && !!props.reload ? props.match : null)
const run = useAction(async () => { await props.reload?.() })
const { busy, guard } = useBusy()
function adopt() {
  const match = adoptable.value
  if (!match || match.contactId === null) return
  void guard(() => run(() => $fetch<{ ok: boolean }>(`/api/children/${props.child.id}/adopt-school`, {
    method: 'POST', body: { contactId: match.contactId },
  }), t.adopted))
}
</script>

<template>
  <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sky-50 p-2 text-sm text-sky-950 ring-1 ring-sky-200">
    <UIcon name="i-lucide-school" class="size-4 shrink-0" aria-hidden="true" />
    <span v-if="match.status !== 'match'" class="text-xs text-sky-800">{{ t.label }}:</span>
    <span class="font-medium">{{ shown.text }}</span>
    <span class="text-xs text-sky-800">{{ shown.source }}</span>
    <UButton
      v-if="adoptable" size="xs" color="neutral" variant="outline" icon="i-lucide-arrow-down-to-line" :label="t.adopt"
      :title="t.adoptHint(adoptable.contactName ?? adoptable.name)" :aria-label="t.adoptHint(adoptable.contactName ?? adoptable.name)"
      :loading="busy" :disabled="busy" @click="adopt"
    />
  </div>
</template>
