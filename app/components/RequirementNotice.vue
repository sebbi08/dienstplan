<script setup lang="ts">
import type { DueRequirementDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Yellow notice for Leitung and Träger: mandatory appointments that are overdue, missing or due within two months.
 * Grouped by state, one line per employee (their kinds side by side), each linking to the employee page, where the
 * record is entered. Long groups are cut after a few people until "Alle anzeigen".
 */
const { data: due } = await useFetch<DueRequirementDto[]>('/api/requirements/due')

type State = DueRequirementDto['state']
const STATES: State[] = ['overdue', 'missing', 'soon']
/** People shown per group while collapsed. */
const LIMIT = 3
const expanded = ref(false)

function kindText(row: DueRequirementDto): string {
  if (row.dueOn === null) return row.typeName
  return row.state === 'overdue' ? de.requirements.noticeOverdue(row.typeName, formatDate(row.dueOn)) : de.requirements.noticeDue(row.typeName, formatDate(row.dueOn))
}

/** The rows arrive ordered by state, then name; here the kinds of one person within a state share a line. */
const groups = computed(() => STATES.map((state) => {
  const people = new Map<number, { employeeId: number; name: string; kinds: string[] }>()
  for (const row of due.value ?? []) {
    if (row.state !== state) continue
    const person = people.get(row.employeeId) ?? { employeeId: row.employeeId, name: row.employeeName, kinds: [] }
    person.kinds.push(kindText(row))
    people.set(row.employeeId, person)
  }
  const all = [...people.values()]
  const shown = expanded.value ? all : all.slice(0, LIMIT)
  return { state, total: all.length, shown, hidden: all.length - shown.length }
}).filter(group => group.total > 0))

const collapsible = computed(() => groups.value.some(group => group.total > LIMIT))
</script>

<template>
  <!-- Never on paper: a plan printed straight from the browser may end up on the wall. -->
  <UAlert
    v-if="groups.length" class="print:hidden" color="warning" variant="soft" icon="i-lucide-clipboard-check"
    :title="de.requirements.noticeTitle"
  >
    <template #description>
      <div class="space-y-2">
        <div v-for="group in groups" :key="group.state">
          <p class="font-medium">{{ de.requirements.noticeCount(de.requirements.noticeGroups[group.state], group.total) }}</p>
          <ul class="space-y-0.5">
            <li v-for="person in group.shown" :key="person.employeeId">
              <NuxtLink :to="`/admin/employees/${person.employeeId}#requirements`" class="font-medium underline hover:no-underline">{{ person.name }}</NuxtLink>:
              {{ person.kinds.join(', ') }}
            </li>
            <li v-if="group.hidden > 0">{{ de.requirements.noticeMore(group.hidden) }}</li>
          </ul>
        </div>
        <UButton
          v-if="collapsible" size="xs" color="warning" variant="outline"
          :label="expanded ? de.requirements.showLess : de.requirements.showAll" @click="expanded = !expanded"
        />
      </div>
    </template>
  </UAlert>
</template>
