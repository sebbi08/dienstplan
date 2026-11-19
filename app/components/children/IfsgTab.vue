<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { IfsgCaseDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * Planung → „§ 34 IfSG“ (Leitung and Träger): the facility's cases of the chosen year, all or only the open ones. Per
 * case the day the health office was notified (or „Meldung durch den Arzt liegt nachweislich vor“), the readmission,
 * closing without readmission, deleting a wrong entry and the parents' notice; the list prints as well. The cases are
 * entered by the group in the attendance. No printouts at the tablet.
 */
type Filter = 'all' | 'open'
const s = de.ifsg
const o = s.overview
const { onTablet } = useChildRights()
const confirm = useConfirm()
const year = ref(parseIsoDate(todayIso()).year)
const filter = ref<Filter>('all')
const { data, error, refresh } = await useFetch<IfsgCaseDto[]>('/api/ifsg/cases', { query: { year }, key: 'ifsg-cases', default: () => [] })
const { busy, run } = useBusyAction(async () => {
  await refresh()
  await refreshNuxtData(['children-reminders', 'attendance-day'])
})
const rows = computed(() => (data.value ?? []).filter(row => filter.value === 'all' || row.open))
const filterItems = (['all', 'open'] as const).map(value => ({ label: o.filter[value], value }))

/** The notification day typed per case (empty = none yet). */
const notified = reactive<Record<number, string>>({})
watch(data, (value) => {
  for (const row of value ?? []) notified[row.id] = row.healthOfficeNotifiedOn ?? ''
}, { immediate: true })

const put = (row: IfsgCaseDto, body: Record<string, unknown>, message: string = de.common.saved) =>
  run(() => $fetch<{ ok: boolean }>(`/api/ifsg/cases/${row.id}`, { method: 'PUT', body }), message)
const saveNotified = (row: IfsgCaseDto) => put(row, { healthOfficeNotifiedOn: notified[row.id] || null })
async function end(row: IfsgCaseDto) {
  if (await confirm(o.confirmEnd, { confirmLabel: o.end })) put(row, { ended: true })
}
async function remove(row: IfsgCaseDto) {
  if (await confirm(o.confirmRemove)) run(() => $fetch<{ ok: boolean }>(`/api/ifsg/cases/${row.id}`, { method: 'DELETE' }), de.common.deleted)
}

function statusText(row: IfsgCaseDto): string {
  if (row.readmittedOn) return `${o.columns.readmitted} ${formatDate(row.readmittedOn)}`
  return row.ended ? o.ended : o.open
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <YearNav v-model="year" />
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-for="item in filterItems" :key="item.value" size="sm" :color="filter === item.value ? 'primary' : 'neutral'"
          :variant="filter === item.value ? 'solid' : 'outline'" :label="item.label" :aria-pressed="filter === item.value"
          @click="filter = item.value"
        />
        <span class="text-sm text-gray-500">{{ o.count(rows.length) }}</span>
      </div>
      <UButton
        v-if="!onTablet" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="o.printList"
        :to="`/print/children/ifsg/${year}${filter === 'open' ? '?filter=open' : ''}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ o.intro }}</p>
    <UAlert v-if="error" color="error" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="!rows.length" class="text-sm text-gray-500">{{ o.none }}</p>
    <ul v-else class="space-y-2">
      <li
        v-for="row in rows" :key="row.id" class="space-y-2 rounded-lg bg-white p-3 ring-1"
        :class="row.open ? 'ring-red-300' : 'ring-gray-200'"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-sm text-gray-600">{{ formatDate(row.reportedOn) }}</span>
          <NuxtLink :to="`/children/${row.childId}`" class="font-medium text-sky-700 hover:underline">{{ row.childName }}</NuxtLink>
          <span v-if="row.groupName" class="text-sm text-gray-600">{{ row.groupName }}</span>
          <span class="font-semibold">{{ row.diseaseName }}</span>
          <span class="text-sm text-gray-600">{{ s.kinds[row.kind] }}</span>
          <span class="ml-auto rounded px-2 py-0.5 text-sm font-medium" :class="row.open ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'">
            {{ statusText(row) }}
          </span>
        </div>
        <p class="text-sm text-gray-700">
          {{ o.onset }}: {{ formatDate(row.onsetDate) }}<template v-if="row.earliest"> · {{ o.earliest }}: {{ formatDate(row.earliest) }}</template>
          · {{ s.proof(s.proofs[row.proof]) }} · {{ o.by(row.createdByName) }}
        </p>
        <p v-if="row.readmissionNote" class="text-sm text-gray-700">{{ row.readmissionNote }}</p>
        <div class="flex flex-wrap items-end gap-3" :class="row.notifyDue ? 'rounded-md bg-amber-50 p-2' : ''">
          <UFormField :label="o.notifiedOn">
            <div class="flex items-center gap-2">
              <DateTextInput :model-value="notified[row.id] ?? ''" @update:model-value="notified[row.id] = $event" :label="o.notifiedOn" class="w-44" :max="todayIso()" />
              <UButton
                color="neutral" variant="outline" :label="o.notifySave" :disabled="busy || (notified[row.id] ?? '') === (row.healthOfficeNotifiedOn ?? '')"
                @click="saveNotified(row)"
              />
            </div>
          </UFormField>
          <UCheckbox
            :model-value="row.physicianReported" :label="o.physician" :disabled="busy"
            @update:model-value="put(row, { physicianReported: $event === true })"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="!onTablet" size="sm" color="neutral" variant="outline" icon="i-lucide-printer" :label="o.notice"
            :to="`/print/children/ifsg-notice/${row.id}`" target="_blank"
          />
          <UButton v-if="row.open" size="sm" color="neutral" variant="outline" icon="i-lucide-circle-check" :label="o.end" :disabled="busy" @click="end(row)" />
          <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="o.remove" :disabled="busy" @click="remove(row)" />
        </div>
      </li>
    </ul>
    <p class="text-xs text-gray-500">{{ s.footer }}</p>
  </div>
</template>
