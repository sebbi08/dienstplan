<script setup lang="ts">
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

defineProps<{ plan: MonthPlanDto; isAdmin: boolean }>()
const emit = defineEmits<{ navigate: [year: number, month: number]; release: []; discard: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <MonthNav :year="plan.year" :month="plan.month" @change="(year: number, month: number) => emit('navigate', year, month)" />
    <UBadge
      v-if="plan.release.releasedAt" color="success" variant="soft"
      :label="de.plan.releasedAt(formatDateTime(plan.release.releasedAt), plan.release.releasedBy ?? '')"
    />
    <UBadge v-else color="neutral" variant="soft" :label="de.plan.draft" />
    <UBadge
      v-if="plan.release.changeCount > 0" color="warning" variant="soft"
      :label="isAdmin ? de.plan.releasedChanges(plan.release.changeCount) : de.plan.changesCount(plan.release.changeCount)"
    />
    <UBadge v-if="isAdmin && plan.release.pendingCount > 0" color="warning" variant="outline" :label="de.plan.pendingChanges(plan.release.pendingCount)" />
    <div class="ml-auto flex flex-wrap gap-2 print:hidden">
      <template v-if="isAdmin">
        <UButton
          v-if="plan.release.pendingCount > 0" color="warning" variant="outline" icon="i-lucide-undo-2"
          :label="de.plan.discard" @click="emit('discard')"
        />
        <UButton icon="i-lucide-check" :label="plan.release.releasedAt ? de.plan.rerelease : de.plan.release" @click="emit('release')" />
      </template>
      <UButton color="neutral" variant="outline" icon="i-lucide-printer" :label="de.plan.print" :to="`/print/${plan.year}/${plan.month}`" target="_blank" />
    </div>
  </div>
</template>
