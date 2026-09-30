<script setup lang="ts">
import { formatSignedDuration } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate } from '~/utils/format'
import { warningText } from '~/utils/warnings'

const props = defineProps<{ plan: MonthPlanDto }>()
const emit = defineEmits<{ selectDate: [date: string] }>()
const names = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const warnings = computed(() => props.plan.admin?.warnings ?? [])
</script>

<template>
  <aside class="space-y-3 print:hidden">
    <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="mb-2 font-semibold">{{ de.warnings.title }} ({{ warnings.length }})</h2>
      <p v-if="warnings.length === 0" class="text-sm text-gray-500">{{ de.warnings.none }}</p>
      <ul v-else class="max-h-96 space-y-1 overflow-y-auto text-sm">
        <li v-for="(warning, index) in warnings" :key="index">
          <button type="button" class="text-left hover:underline" @click="emit('selectDate', warning.date)">
            <span class="font-medium">{{ formatDate(warning.date) }}</span> {{ warningText(warning, names) }}
          </button>
        </li>
      </ul>
    </section>
    <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="mb-2 font-semibold">{{ de.balances.title }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th>{{ de.balances.name }}</th><th class="text-right">{{ de.balances.today }}</th><th class="text-right">{{ de.balances.monthEnd }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="balance in plan.admin?.balances ?? []" :key="balance.employeeId" class="border-t border-gray-100">
            <td class="py-1">{{ balance.name }}</td>
            <td class="py-1 text-right font-medium" :class="balanceClass(balance.today)">{{ formatSignedDuration(balance.today) }}</td>
            <td class="py-1 text-right font-medium" :class="balanceClass(balance.monthEnd)">{{ formatSignedDuration(balance.monthEnd) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-xs text-gray-500">{{ de.balances.hint }}</p>
    </section>
  </aside>
</template>
