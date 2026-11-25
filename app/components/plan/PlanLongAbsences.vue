<script setup lang="ts">
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { longAbsencePeople, periodText, shortReasonText } from '~/utils/longAbsence'

/**
 * The line below the plan „Längere Abwesenheit: N Personen“ (only when there is someone): a click opens the names with
 * their periods; the reason only where the server sends it (viewers who may see it). It follows the group chosen above
 * the plan. A plan editor gets „im Plan zeigen“ at each person taken out of the plan: the column comes back for this
 * view (to correct a cell or plan work) until „ausblenden“ or another month. The print view shows the list open,
 * without the buttons.
 */
const props = defineProps<{ plan: MonthPlanDto; print?: boolean; groupFilter?: number | null; revealed?: ReadonlySet<number> }>()
const emit = defineEmits<{ toggle: [employeeId: number] }>()
const t = de.longAbsence
const open = ref(false)
const id = useId()
const people = computed(() => longAbsencePeople(props.plan, props.groupFilter ?? null))
const count = computed(() => new Set(people.value.map(item => item.employeeId)).size)
const hidden = computed(() => new Set(props.plan.longAbsence?.hidden ?? []))
/** The toggle stands at a person's first line only (several periods are several lines). */
const toggleAt = computed(() => new Set(people.value.map((item, index) => ({ item, index }))
  .filter(({ item, index }) => people.value.findIndex(other => other.employeeId === item.employeeId) === index)
  .map(({ index }) => index)))
const canToggle = (employeeId: number, index: number) =>
  !props.print && props.plan.admin !== null && hidden.value.has(employeeId) && toggleAt.value.has(index)
</script>

<template>
  <div v-if="count" class="text-sm text-gray-700 print:break-inside-avoid print:text-xs">
    <button
      v-if="!print" type="button" class="inline-flex items-center gap-1 rounded font-medium hover:underline focus-visible:outline-2 focus-visible:outline-sky-500"
      :aria-expanded="open" :aria-controls="id" :title="t.planLineHint" @click="open = !open"
    >
      <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
      {{ t.planLine(count) }}
    </button>
    <p v-else class="font-semibold">{{ t.planLine(count) }}</p>
    <ul v-show="open || print" :id="id" class="mt-1 space-y-0.5 pl-5 print:mt-0">
      <li v-for="(item, index) in people" :key="`${item.employeeId}-${index}`" class="flex flex-wrap items-baseline gap-x-2">
        <span>
          <span class="font-medium">{{ item.name }}</span> · {{ periodText(item.from, item.to) }}<template v-if="item.reason"> · {{ shortReasonText(item.reason) }}</template>
        </span>
        <button
          v-if="canToggle(item.employeeId, index)" type="button" class="text-xs text-sky-700 hover:underline"
          :aria-pressed="revealed?.has(item.employeeId) ?? false" :title="t.showInPlanHint" @click="emit('toggle', item.employeeId)"
        >
          {{ revealed?.has(item.employeeId) ? t.hideInPlan : t.showInPlan }}
        </button>
      </li>
    </ul>
  </div>
</template>
