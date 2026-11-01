<script setup lang="ts">
import type { ClosureLeaveDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

// What each closure took from one person's leave in a year, with the total (employee page and „Mein Urlaub“).
const props = defineProps<{ closures: ClosureLeaveDto[] }>()
const total = computed(() => props.closures.reduce((sum, closure) => sum + closure.days, 0))
</script>

<template>
  <div v-if="closures.length" class="text-sm text-gray-700">
    <p class="text-xs font-medium text-gray-500">{{ de.leave.closuresTitle }}</p>
    <ul>
      <li v-for="closure in closures" :key="closure.closureId">
        {{ closure.label }} <span class="text-gray-500">({{ formatDate(closure.startDate) }}–{{ formatDate(closure.endDate) }})</span>:
        {{ de.leave.days(closure.days) }}
        <span v-if="closure.closureDays" class="text-xs text-gray-500">({{ de.leave.closureDays(closure.closureDays) }})</span>
      </li>
      <li v-if="closures.length > 1" class="font-semibold">{{ de.leave.closuresTotal }}: {{ de.leave.days(total) }}</li>
    </ul>
  </div>
</template>
