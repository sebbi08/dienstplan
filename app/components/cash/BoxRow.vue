<script setup lang="ts">
import { formatCents } from '#shared/domain/cash'
import type { CashBoxDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { monthTitle } from '~/utils/format'

/**
 * One box in the overview: name, kind, balance today, closing state, missing receipts. While reordering, arrows move it
 * within its scope (`first`/`last`: it is already at that end).
 */
defineProps<{ box: CashBoxDto; to: string; reordering?: boolean; first?: boolean; last?: boolean }>()
const emit = defineEmits<{ edit: []; move: [direction: 'up' | 'down'] }>()
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
    <span v-if="reordering" class="-my-1 flex shrink-0">
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.cash.moveUp(box.name)" :disabled="first" @click="emit('move', 'up')" />
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.cash.moveDown(box.name)" :disabled="last" @click="emit('move', 'down')" />
    </span>
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
    <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.cash.editBox(box.name)" @click="emit('edit')" />
  </li>
</template>
