<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import {
  filterWarnings, warningAckKey, warningSections, warningSignature, type WarningCategory, type WarningFilter, type WarningLine,
} from '#shared/domain/warningList'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'
import { openDaysOf, readWarningFilter, warningLineText, warningSummary, writeWarningFilter } from '~/utils/warnings'

/**
 * The plan's warnings for Leitung and Träger: three groups (Besetzung, Dienstplan-Lücken, Zeiterfassung), identical
 * warnings on consecutive days in one line, past days of the first two folded away, and „Zur Kenntnis genommen“.
 */
const props = defineProps<{ plan: MonthPlanDto }>()
const emit = defineEmits<{ selectDate: [date: string]; changed: [] }>()
const run = useAction()

const names = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const all = computed(() => props.plan.admin?.warnings ?? [])
const acks = computed(() => new Map((props.plan.admin?.warningAcks ?? []).map(ack => [ack.key, ack])))
const ackSignatures = computed(() => new Map([...acks.value].map(([key, ack]) => [key, ack.signature])))
const openDays = computed(() => openDaysOf(props.plan.days))
const today = todayIso()

// Filter by group and person, remembered per device; read after mounting so the server-rendered page agrees.
const filter = ref<WarningFilter>({ groupId: null, employeeId: null })
onMounted(() => {
  filter.value = readWarningFilter()
})
const groupItems = computed(() => [
  { label: de.warnings.filterAll, value: 0 },
  ...props.plan.groups.map(group => ({ label: group.name, value: group.id })),
])
const staff = computed(() => props.plan.employees.filter(employee => !employee.helpFrom))
const employeeItems = computed(() => [
  { label: de.warnings.filterAll, value: 0 },
  ...staff.value.map(employee => ({ label: employee.name, value: employee.id })),
])
function setFilter(change: Partial<WarningFilter>) {
  filter.value = { ...filter.value, ...change }
  writeWarningFilter(filter.value)
}
const groupSelect = computed({
  get: () => (props.plan.groups.some(group => group.id === filter.value.groupId) ? filter.value.groupId! : 0),
  set: (value: number) => setFilter({ groupId: value || null }),
})
const employeeSelect = computed({
  get: () => (staff.value.some(employee => employee.id === filter.value.employeeId) ? filter.value.employeeId! : 0),
  set: (value: number) => setFilter({ employeeId: value || null }),
})
const context = computed(() => ({
  employeeGroups: new Map(props.plan.employees.map(employee => [employee.id, employee.groupId ?? null])),
  groupNames: new Map(props.plan.groups.map(group => [group.id, group.name])),
}))
const shown = computed(() => filterWarnings(all.value, { groupId: groupSelect.value || null, employeeId: employeeSelect.value || null }, context.value))

const sections = computed(() => warningSections(shown.value, ackSignatures.value, openDays.value, today))
const summary = computed(() => warningSummary(sections.value))
const acknowledgedCount = computed(() => sections.value.reduce((sum, section) => sum + section.acknowledgedCount, 0))

const closed = ref(new Set<WarningCategory>())
const pastOpen = ref(new Set<WarningCategory>())
const showAcknowledged = ref(false)
function toggle(set: Set<WarningCategory>, category: WarningCategory) {
  if (set.has(category)) set.delete(category)
  else set.add(category)
}

const lineKey = (line: WarningLine) => warningAckKey(line.warnings[0]!) + line.to

async function acknowledge(line: WarningLine) {
  const items = line.warnings.map(warning => ({ key: warningAckKey(warning), signature: warningSignature(warning) }))
  if (await run(() => $fetch('/api/plan/warning-acks', { method: 'POST', body: { items } }))) emit('changed')
}

async function undo(line: WarningLine) {
  const keys = line.warnings.map(warningAckKey)
  if (await run(() => $fetch('/api/plan/warning-acks', { method: 'DELETE', body: { keys } }))) emit('changed')
}

function acknowledgedTitle(line: WarningLine): string {
  const ack = acks.value.get(warningAckKey(line.warnings[0]!))
  return ack ? de.warnings.acknowledgedBy(ack.byName, formatDateTime(ack.at)) : ''
}
</script>

<template>
  <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.warnings.title }} ({{ summary.total }})</h2>
    <p v-if="all.length === 0" class="mt-2 text-sm text-gray-500">{{ de.warnings.none }}</p>
    <template v-else>
      <p class="mb-2 text-sm text-gray-600">{{ summary.line }}</p>
      <div class="mb-2 flex flex-wrap gap-2">
        <USelect
          v-if="plan.groups.length" v-model="groupSelect" :items="groupItems" size="sm" class="min-w-28 flex-1"
          :aria-label="de.warnings.filterGroup" :placeholder="de.warnings.filterGroup"
        />
        <USelect
          v-model="employeeSelect" :items="employeeItems" size="sm" class="min-w-28 flex-1"
          :aria-label="de.warnings.filterEmployee" :placeholder="de.warnings.filterEmployee"
        />
      </div>
      <p v-if="shown.length === 0" class="text-sm text-gray-500">{{ de.warnings.noneFiltered }}</p>
      <div v-else class="max-h-[32rem] space-y-2 overflow-y-auto text-sm">
        <div v-for="section in sections" :key="section.category">
          <button
            type="button" class="flex w-full items-center gap-1 text-left font-medium"
            :aria-expanded="!closed.has(section.category)" @click="toggle(closed, section.category)"
          >
            <UIcon :name="closed.has(section.category) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
            {{ de.warnings.categories[section.category] }} ({{ section.count }})
          </button>
          <div v-if="!closed.has(section.category)" class="ml-5 mt-1 space-y-1">
            <p v-if="section.count === 0 && !(showAcknowledged && section.acknowledged.length)" class="text-gray-500">{{ de.warnings.categoryNone }}</p>
            <ul class="space-y-1">
              <li v-for="line in section.current" :key="lineKey(line)" class="flex items-start gap-1">
                <button type="button" class="flex-1 text-left hover:underline" :title="de.warnings.jumpHint" @click="emit('selectDate', line.from)">
                  {{ warningLineText(line, names) }}
                </button>
                <UButton
                  size="xs" color="neutral" variant="ghost" icon="i-lucide-check" class="shrink-0"
                  :title="`${de.warnings.acknowledge} – ${de.warnings.acknowledgeHint}`" :aria-label="de.warnings.acknowledge"
                  @click="acknowledge(line)"
                />
              </li>
            </ul>
            <template v-if="section.past.length">
              <button
                type="button" class="flex items-center gap-1 text-left text-gray-600"
                :aria-expanded="pastOpen.has(section.category)" @click="toggle(pastOpen, section.category)"
              >
                <UIcon :name="pastOpen.has(section.category) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0" aria-hidden="true" />
                {{ de.warnings.past(section.past.reduce((sum, line) => sum + line.warnings.length, 0)) }}
              </button>
              <ul v-if="pastOpen.has(section.category)" class="ml-5 space-y-1">
                <li v-for="line in section.past" :key="lineKey(line)" class="flex items-start gap-1">
                  <button type="button" class="flex-1 text-left hover:underline" :title="de.warnings.jumpHint" @click="emit('selectDate', line.from)">
                    {{ warningLineText(line, names) }}
                  </button>
                  <UButton
                    size="xs" color="neutral" variant="ghost" icon="i-lucide-check" class="shrink-0"
                    :title="`${de.warnings.acknowledge} – ${de.warnings.acknowledgeHint}`" :aria-label="de.warnings.acknowledge"
                    @click="acknowledge(line)"
                  />
                </li>
              </ul>
            </template>
            <ul v-if="showAcknowledged && section.acknowledged.length" class="space-y-1 text-gray-400">
              <li v-for="line in section.acknowledged" :key="lineKey(line)" class="flex items-start gap-1" :title="acknowledgedTitle(line)">
                <button type="button" class="flex-1 text-left hover:underline" @click="emit('selectDate', line.from)">
                  {{ warningLineText(line, names) }}
                </button>
                <UButton size="xs" color="neutral" variant="link" class="shrink-0" @click="undo(line)">{{ de.warnings.undo }}</UButton>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <UButton
        v-if="acknowledgedCount > 0" size="xs" color="neutral" variant="link" class="mt-2 px-0"
        @click="showAcknowledged = !showAcknowledged"
      >
        {{ showAcknowledged ? de.warnings.hideAcknowledged : de.warnings.showAcknowledged(acknowledgedCount) }}
      </UButton>
    </template>
  </section>
</template>
