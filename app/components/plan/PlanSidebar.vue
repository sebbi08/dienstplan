<script setup lang="ts">
import { formatSignedDuration } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'

defineProps<{ plan: MonthPlanDto }>()
const emit = defineEmits<{ selectDate: [date: string]; changed: [] }>()
</script>

<template>
  <aside class="space-y-3 print:hidden">
    <PlanWarnings :plan="plan" @select-date="emit('selectDate', $event)" @changed="emit('changed')" />
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
