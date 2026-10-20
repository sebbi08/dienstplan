<script setup lang="ts">
import { addDays, todayIso } from '#shared/domain/dates'
import { kitaYearLabel, kitaYearOf } from '#shared/domain/kitaYear'
import type { OccupancyCellDto, OccupancyDto, OccupancyRowDto, SchoolSettingsDto, UpcomingSchoolChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, monthTitle } from '~/utils/format'
import { occupancyCellLabel, occupancyMonthShort, occupancyRowName } from '~/utils/occupancy'

/**
 * Managers only: the occupancy of a Kita year by group and month, with the places of each group editable in place. A click on a cell
 * lists its children below the table. The server counts; this view only shows (red cells carry a text and an icon, not just the colour).
 */
// At the tablet there are no printouts and no settings: the places are only shown, not edited.
const { onTablet } = useChildRights()
const year = ref(kitaYearOf(todayIso()))
const { data, error, refresh } = useFetch<OccupancyDto>('/api/children/occupancy', { query: { year }, key: 'children-occupancy' })

// The places are part of the group list too; keep that cache in step.
const run = useAction(async () => {
  await Promise.all([refresh(), refreshNuxtData(['groups', 'child-groups'])])
})
// Only the field that is being saved is disabled, so tabbing on to the next field keeps the focus.
const saving = reactive<Record<number, boolean>>({})

const rows = computed(() => data.value?.rows ?? [])
const months = computed(() => data.value?.months ?? [])

// One draft per group for the places; a refresh keeps a draft with an unsaved edit.
const drafts = reactive<Record<number, string>>({})
const stored = new Map<number, string>()
watch(data, (value) => {
  for (const row of value?.rows ?? []) {
    if (row.groupId === null) continue
    const text = row.capacity === null ? '' : String(row.capacity)
    if (drafts[row.groupId] === undefined || drafts[row.groupId] === stored.get(row.groupId)) drafts[row.groupId] = text
    stored.set(row.groupId, text)
  }
}, { immediate: true })

/** Saves on blur (Enter blurs the field); an empty field removes the places. A failed save puts the stored value back. */
async function saveCapacity(row: OccupancyRowDto) {
  const id = row.groupId
  if (id === null || onTablet.value) return
  const text = (drafts[id] ?? '').trim()
  if (text === (stored.get(id) ?? '')) return
  if (saving[id]) return
  saving[id] = true
  const ok = await run(() => $fetch<unknown>(`/api/groups/${id}/capacity`, { method: 'PUT', body: { capacity: text === '' ? null : Number(text) } }), de.common.saved)
  saving[id] = false
  if (!ok) drafts[id] = stored.get(id) ?? ''
}
const blurOnEnter = (event: KeyboardEvent) => (event.target as HTMLInputElement).blur()

// The cell whose children are listed below the table (rowKey: group id, 'none' or 'total').
const selected = ref<{ rowKey: string; month: number } | null>(null)
watch(year, () => (selected.value = null))
const rowKey = (row: OccupancyRowDto) => String(row.groupId ?? 'none')
const detail = computed(() => {
  const pick = selected.value
  if (!pick || !data.value) return null
  const row = rows.value.find(candidate => rowKey(candidate) === pick.rowKey)
  const cell: OccupancyCellDto | undefined = pick.rowKey === 'total' ? data.value.total.cells[pick.month] : row?.cells[pick.month]
  const month = months.value[pick.month]
  if (!cell || !month) return null
  const group = pick.rowKey === 'total' ? de.occupancy.total : row ? occupancyRowName(row) : ''
  return { title: de.occupancy.cellTitle(group, monthTitle(month.year, month.month)), cell }
})
const toggle = (key: string, month: number) => {
  selected.value = selected.value?.rowKey === key && selected.value.month === month ? null : { rowKey: key, month }
}

// The list "Schulkinder zum 1.9.": the children whose school start is the coming 1 September or already reached. With the
// automatic leaving off, each child can be deregistered here by hand to the day before its school start.
const { data: schoolChildren } = useFetch<UpcomingSchoolChildDto[]>('/api/children/school-children', { key: 'children-school-children' })
// The school settings are a settings route, which the tablet never gets: there the list is shown without the
// "deregister now" buttons.
const { data: schoolSettings } = useFetch<SchoolSettingsDto>('/api/school-settings', { key: 'school-settings', immediate: !onTablet.value })
const { groupName } = useChildLookups()
const confirm = useConfirm()
const { busy: leaving, run: runLeave } = useBusyAction(async () => {
  await Promise.all([refreshNuxtData(['children-school-children', 'children-occupancy', 'children-active', 'children-archive', 'children-open', 'child-documents-overview'])])
})
const today = todayIso()
const manualLeave = computed(() => !onTablet.value && schoolSettings.value?.autoLeave === false)
async function leaveAtSchoolStart(child: UpcomingSchoolChildDto) {
  const leftOn = addDays(child.schoolStart, -1)
  if (!await confirm(de.childLifecycle.confirmLeave(child.name, formatDate(leftOn)), { confirmLabel: de.childLifecycle.leave })) return
  runLeave(() => $fetch<unknown>(`/api/children/${child.id}/leave`, { method: 'POST', body: { leftOn } }), de.common.saved)
}

const th = 'px-2 py-2 text-center'
const td = 'px-2 py-1.5 text-center'
const stay = (from: string, to: string | null) => de.occupancy.stay(formatDate(from), to ? formatDate(to) : de.occupancy.open)
</script>

<template>
  <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
  <div v-else class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" :aria-label="de.year.previous" @click="year--" />
        <span class="min-w-24 text-center text-xl font-semibold" :aria-label="de.occupancy.kitaYear">{{ kitaYearLabel(year) }}</span>
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" :aria-label="de.year.next" @click="year++" />
      </div>
      <UButton v-if="!onTablet" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.occupancy.print" :to="`/print/children/occupancy/${year}`" target="_blank" />
    </div>

    <template v-if="data">
      <p class="text-sm text-gray-500">{{ de.occupancy.hint }}</p>
      <p v-if="rows.length && data.total.fromFacility && data.total.capacity !== null" class="text-sm text-gray-500">
        {{ de.occupancy.totalAgainstFacility(data.total.capacity) }}
      </p>
      <p v-if="!rows.length" class="text-sm text-gray-500">{{ de.occupancy.empty }}</p>
      <div v-else class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
        <table class="w-full bg-white text-sm">
          <thead class="bg-gray-100 text-xs text-gray-600">
            <tr>
              <th :class="[th, 'text-left']">{{ de.occupancy.group }}</th>
              <th :class="th">{{ de.occupancy.capacity }}</th>
              <th v-for="month in months" :key="`${month.year}-${month.month}`" :class="th" :title="monthTitle(month.year, month.month)">{{ occupancyMonthShort(month.month) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="rowKey(row)" class="border-t border-gray-100">
              <th scope="row" :class="[td, 'text-left font-medium']">{{ occupancyRowName(row) }}</th>
              <td :class="td">
                <template v-if="onTablet">{{ row.capacity ?? de.children.noValue }}</template>
                <input
                  v-else-if="row.groupId !== null" type="number" :value="drafts[row.groupId]" min="1" max="200" step="1" :disabled="saving[row.groupId]"
                  class="w-16 rounded border border-gray-300 px-1 py-0.5 text-center" :aria-label="de.occupancy.capacityOf(row.name)"
                  @input="drafts[row.groupId!] = ($event.target as HTMLInputElement).value" @blur="saveCapacity(row)" @keydown.enter.prevent="blurOnEnter"
                >
              </td>
              <td v-for="(cell, index) in row.cells" :key="index" class="p-0.5">
                <ChildrenOccupancyCell
                  :cell="cell" :label="occupancyCellLabel(occupancyRowName(row), months[index]!, cell)"
                  :selected="selected?.rowKey === rowKey(row) && selected.month === index" @select="toggle(rowKey(row), index)"
                />
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-gray-300 font-semibold">
              <th scope="row" :class="[td, 'text-left']">{{ de.occupancy.total }}</th>
              <td :class="td" :title="data.total.fromFacility ? de.occupancy.facilityCapacity : undefined">{{ data.total.capacity ?? de.children.noValue }}</td>
              <td v-for="(cell, index) in data.total.cells" :key="index" class="p-0.5">
                <ChildrenOccupancyCell
                  :cell="cell" :label="occupancyCellLabel(de.occupancy.total, months[index]!, cell)"
                  :selected="selected?.rowKey === 'total' && selected.month === index" @select="toggle('total', index)"
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section v-if="detail" class="space-y-2 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200" aria-live="polite">
        <h2 class="font-semibold">{{ detail.title }}</h2>
        <p v-if="!detail.cell.present.length && !detail.cell.fresh.length" class="text-gray-500">{{ de.occupancy.none }}</p>
        <div v-for="list in [
          { key: 'present', title: de.occupancy.present, names: detail.cell.present },
          { key: 'fresh', title: de.occupancy.fresh, names: detail.cell.fresh },
        ].filter(entry => entry.names.length)" :key="list.key">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ list.title }} ({{ list.names.length }})</h3>
          <ul class="mt-1 space-y-0.5">
            <li v-for="child in list.names" :key="child.id" class="flex flex-wrap gap-x-3">
              <NuxtLink :to="`/children/${child.id}`" class="font-medium text-sky-700 hover:underline">{{ child.name }}</NuxtLink>
              <span class="text-gray-500">{{ stay(child.from, child.to) }}</span>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="schoolChildren?.length" class="space-y-2 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
        <h2 class="font-semibold">{{ de.schoolChildren.listTitle('1.9.') }}</h2>
        <p class="text-gray-500">{{ de.schoolChildren.listHint }}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="text-xs text-gray-600">
              <tr>
                <th class="px-2 py-1">{{ de.children.fields.name }}</th>
                <th class="px-2 py-1">{{ de.occupancy.group }}</th>
                <th class="px-2 py-1">{{ de.schoolChildren.schoolStart }}</th>
                <th class="px-2 py-1">{{ de.schoolChildren.afterSchoolGroup }}</th>
                <th v-if="manualLeave" class="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="child in schoolChildren" :key="child.id" class="border-t border-gray-100">
                <td class="px-2 py-1.5"><NuxtLink :to="`/children/${child.id}`" class="font-medium text-sky-700 hover:underline">{{ child.name }}</NuxtLink></td>
                <td class="px-2 py-1.5">{{ groupName(child.groupId) }}</td>
                <td class="px-2 py-1.5">
                  {{ formatDate(child.schoolStart) }}
                  <span v-if="child.schoolStart <= today" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{{ de.schoolChildren.reached }}</span>
                </td>
                <td class="px-2 py-1.5">{{ child.pendingSchoolGroup ?? de.children.noValue }}</td>
                <td v-if="manualLeave" class="whitespace-nowrap px-2 py-1.5 text-right">
                  <UButton
                    v-if="child.pendingSchoolGroup === null" size="xs" color="neutral" variant="outline" :label="de.schoolChildren.leaveNow"
                    :aria-label="`${de.schoolChildren.leaveNow}: ${child.name}`" :loading="leaving" :disabled="leaving" @click="leaveAtSchoolStart(child)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details v-if="data.undated.length" class="rounded-lg bg-white p-3 text-sm ring-1 ring-gray-200">
        <summary class="cursor-pointer">{{ de.occupancy.undated(data.undated.length) }}</summary>
        <ul class="mt-2 space-y-0.5">
          <li v-for="child in data.undated" :key="child.id"><NuxtLink :to="`/children/${child.id}`" class="text-sky-700 hover:underline">{{ child.name }}</NuxtLink></li>
        </ul>
      </details>
      <details v-if="data.inconsistent.length" class="rounded-lg bg-white p-3 text-sm ring-1 ring-gray-200">
        <summary class="cursor-pointer">{{ de.occupancy.inconsistent(data.inconsistent.length) }}</summary>
        <ul class="mt-2 space-y-0.5">
          <li v-for="child in data.inconsistent" :key="child.id"><NuxtLink :to="`/children/${child.id}`" class="text-sky-700 hover:underline">{{ child.name }}</NuxtLink></li>
        </ul>
      </details>
    </template>
  </div>
</template>
