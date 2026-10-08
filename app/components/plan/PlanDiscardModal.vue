<script setup lang="ts">
import { cellKey } from '#shared/domain/cells'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'
import { busyCellKeys, isMarker } from '~/utils/helpOuts'

const props = defineProps<{ plan: MonthPlanDto }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [keys: string[]] }>()

// People only in the release (e.g. moved to another facility) are named as they were released.
const names = computed(() => new Map([...(props.plan.admin?.releasedEmployees ?? []), ...props.plan.employees]
  .map(employee => [employee.id, employee.name])))
const weekdays = computed(() => new Map(props.plan.days.map(day => [day.date, day.weekday])))
/**
 * Days another plan now owns, which the server skips on discard: in the home facility a help-out elsewhere (marker),
 * in the helping facility a helper's day the home facility (or a third one) has taken over ("belegt").
 */
const plannedElsewhere = computed(() => new Set([
  ...props.plan.entries.filter(entry => isMarker(entry, props.plan.facilityId)).map(entry => cellKey(entry.employeeId, entry.date)),
  ...busyCellKeys(props.plan),
]))

/** One row per not yet released change, ordered by day, then person / info field. */
const rows = computed(() => Object.entries(props.plan.admin?.pendingChanges ?? {})
  .map(([key, change]) => {
    const [prefix, date] = key.split('|') as [string, string]
    const who = prefix === 'info1' ? de.plan.info1 : prefix === 'info2' ? de.plan.info2 : names.value.get(Number(prefix)) ?? '?'
    return {
      key, date, who, before: change.before || de.plan.empty, after: change.after || de.plan.empty,
      discardable: !plannedElsewhere.value.has(key),
    }
  })
  .sort((a, b) => a.date.localeCompare(b.date) || a.who.localeCompare(b.who)))
const discardableKeys = computed(() => rows.value.filter(row => row.discardable).map(row => row.key))

const selected = ref(new Set<string>())
// Nothing is preselected: the admin ticks exactly what should be discarded.
watch(open, (isOpen) => {
  if (isOpen) selected.value = new Set()
})

const allSelected = computed(() => discardableKeys.value.length > 0 && selected.value.size === discardableKeys.value.length)
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(discardableKeys.value)
}
function toggle(key: string) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}
function submit() {
  if (selected.value.size === 0) return
  emit('submit', [...selected.value])
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="de.modal.discardTitle" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <p class="mb-3 text-sm text-gray-600">{{ de.modal.discardHint }}</p>
      <label class="mb-2 flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" :checked="allSelected" :disabled="discardableKeys.length === 0" @change="toggleAll"> {{ de.modal.discardSelectAll }}
      </label>
      <ul class="max-h-96 divide-y divide-gray-100 overflow-y-auto rounded ring-1 ring-gray-200">
        <li v-for="row in rows" :key="row.key">
          <label
            class="flex items-start gap-2 px-2 py-1.5 text-sm"
            :class="row.discardable ? 'cursor-pointer hover:bg-gray-50' : 'text-gray-500'"
          >
            <input
              type="checkbox" class="mt-1" :checked="selected.has(row.key)" :disabled="!row.discardable"
              @change="toggle(row.key)"
            >
            <span class="w-24 shrink-0 font-medium">{{ formatDayShort(row.date, weekdays.get(row.date) ?? 0) }}</span>
            <span class="w-24 shrink-0">{{ row.who }}</span>
            <span class="min-w-0">
              <span class="text-gray-500 line-through">{{ row.before }}</span>
              <span class="mx-1">→</span>
              <span>{{ row.after }}</span>
              <span v-if="!row.discardable" class="block text-xs text-gray-500">{{ de.modal.discardNotHere }}</span>
            </span>
          </label>
        </li>
      </ul>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        <UButton color="error" :disabled="selected.size === 0" :label="de.modal.discardSubmit(selected.size)" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
