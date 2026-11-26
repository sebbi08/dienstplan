<script setup lang="ts">
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/**
 * groupFilter: the group chosen above the plan; the print view shows the same blocks. canRelease: „Freigeben“ and
 * „Änderungen verwerfen“ (plan.release). printable: „Drucken“ (not in the plan editor at the tablet, whose printout
 * would show the draft in a tab that outlasts the lock; the tablet's start page prints the released plan).
 */
const props = withDefaults(defineProps<{ plan: MonthPlanDto; isAdmin: boolean; canRelease?: boolean; printable?: boolean; groupFilter?: number | null }>(), {
  canRelease: true, printable: true, groupFilter: null,
})
const printLink = computed(() => `/print/${props.plan.year}/${props.plan.month}${props.groupFilter ? `?group=${props.groupFilter}` : ''}`)
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
      <template v-if="isAdmin && canRelease">
        <UButton
          v-if="plan.release.pendingCount > 0" color="warning" variant="outline" icon="i-lucide-undo-2"
          :label="de.plan.discard" @click="emit('discard')"
        />
        <UButton icon="i-lucide-check" :label="plan.release.releasedAt ? de.plan.rerelease : de.plan.release" @click="emit('release')" />
      </template>
      <UButton v-if="printable" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.plan.print" :to="printLink" target="_blank" />
    </div>
  </div>
</template>
