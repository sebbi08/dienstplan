<script setup lang="ts">
import { formatCents } from '#shared/domain/cash'
import type { CashBoxDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { monthTitle } from '~/utils/format'

/** One box in the overview: name, kind, balance today, closing state, missing receipts. */
defineProps<{ box: CashBoxDto; to: string }>()
const emit = defineEmits<{ edit: [] }>()
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <NuxtLink :to="to" class="font-medium text-sky-700 hover:underline">{{ box.name }}</NuxtLink>
        <UBadge color="neutral" variant="subtle" size="sm" :label="de.cash.kinds[box.kind]" />
        <UBadge v-if="box.archived" color="neutral" variant="outline" size="sm" :label="de.cash.archived" />
        <UBadge v-if="box.missingReceipts" color="warning" variant="subtle" size="sm" icon="i-lucide-receipt" :label="de.cash.missingReceipts" />
      </div>
      <div class="text-xs text-gray-500">
        {{ box.closedThrough ? de.cash.closedThrough(monthTitle(box.closedThrough.year, box.closedThrough.month)) : de.cash.noneClosed }}
      </div>
    </div>
    <div class="text-right">
      <div class="text-xs text-gray-500">{{ de.cash.balanceToday }}</div>
      <div class="font-semibold tabular-nums" :class="box.kind === 'cash' && box.balanceToday < 0 ? 'text-red-600' : ''">{{ formatCents(box.balanceToday) }}</div>
    </div>
    <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.cash.edit" @click="emit('edit')" />
  </li>
</template>
