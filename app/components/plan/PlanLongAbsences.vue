<script setup lang="ts">
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { periodText, shortReasonText } from '~/utils/longAbsence'

/**
 * The line below the plan „Längere Abwesenheit: N Personen“ (only when there is someone): a click opens the names with
 * their periods; the reason only where the server sends it (viewers who may see it), never „abwesend“ spelled out per
 * line. The print view shows the list open.
 */
const props = defineProps<{ plan: MonthPlanDto; print?: boolean }>()
const t = de.longAbsence
const open = ref(false)
const id = useId()
const people = computed(() => props.plan.longAbsence?.people ?? [])
const count = computed(() => new Set(people.value.map(item => item.employeeId)).size)
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
      <li v-for="(item, index) in people" :key="`${item.employeeId}-${index}`">
        <span class="font-medium">{{ item.name }}</span> · {{ periodText(item.from, item.to) }}<template v-if="item.reason"> · {{ shortReasonText(item.reason) }}</template>
      </li>
    </ul>
  </div>
</template>
