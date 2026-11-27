<script setup lang="ts">
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/**
 * groupFilter: the group chosen above the plan; the print view shows the same blocks. canRelease: „Freigeben“ and
 * „Änderungen verwerfen“ (plan.release). printable: „Drucken“ (not in the plan editor at the tablet, whose printout
 * would show the draft in a tab that outlasts the lock; the tablet's start page prints the released plan).
 * compact: the editing view – one shared row with the toolbar and the group filter (default slot) and more buttons
 * before „Freigeben“ (slot `actions`); it wraps to a second row on narrower screens. The release badge is short there
 * („Freigegeben“, the whole text as its tooltip and in the notices line below).
 */
const props = withDefaults(defineProps<{
  plan: MonthPlanDto; isAdmin: boolean; canRelease?: boolean; printable?: boolean; groupFilter?: number | null; compact?: boolean
}>(), {
  canRelease: true, printable: true, groupFilter: null, compact: false,
})
const printLink = computed(() => `/print/${props.plan.year}/${props.plan.month}${props.groupFilter ? `?group=${props.groupFilter}` : ''}`)
const releasedText = computed(() => (props.plan.release.releasedAt
  ? de.plan.releasedAt(formatDateTime(props.plan.release.releasedAt), props.plan.release.releasedBy ?? '')
  : ''))
/** Compact: smaller buttons, so the shared row wraps less. */
const buttonSize = computed(() => (props.compact ? 'sm' : 'md'))
const emit = defineEmits<{ navigate: [year: number, month: number]; release: []; discard: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center" :class="compact ? 'gap-x-2 gap-y-1.5' : 'gap-3'">
    <MonthNav :year="plan.year" :month="plan.month" :compact="compact" @change="(year: number, month: number) => emit('navigate', year, month)" />
    <UBadge
      v-if="plan.release.releasedAt" color="success" variant="soft"
      :label="compact ? de.plan.released : releasedText" :title="compact ? releasedText : undefined"
    />
    <UBadge v-else color="neutral" variant="soft" :label="de.plan.draft" />
    <UBadge
      v-if="plan.release.changeCount > 0" color="warning" variant="soft"
      :label="isAdmin ? de.plan.releasedChanges(plan.release.changeCount) : de.plan.changesCount(plan.release.changeCount)"
    />
    <UBadge v-if="isAdmin && plan.release.pendingCount > 0" color="warning" variant="outline" :label="de.plan.pendingChanges(plan.release.pendingCount)" />
    <slot />
    <div class="ml-auto flex flex-wrap items-center print:hidden" :class="compact ? 'gap-1.5' : 'gap-2'">
      <slot name="actions" />
      <template v-if="isAdmin && canRelease">
        <!-- Compact: below 2xl only the icon (the name and the tooltip stay). -->
        <UButton
          v-if="plan.release.pendingCount > 0" :size="buttonSize" color="warning" variant="outline" icon="i-lucide-undo-2"
          :aria-label="de.plan.discard" :title="compact ? de.plan.discard : undefined" @click="emit('discard')"
        >
          <span :class="compact ? 'hidden 2xl:inline' : ''">{{ de.plan.discard }}</span>
        </UButton>
        <UButton :size="buttonSize" icon="i-lucide-check" :label="plan.release.releasedAt ? de.plan.rerelease : de.plan.release" @click="emit('release')" />
      </template>
      <UButton
        v-if="printable" :size="buttonSize" color="neutral" variant="outline" icon="i-lucide-printer" :to="printLink" target="_blank"
        :aria-label="de.plan.print" :title="compact ? de.plan.print : undefined"
      >
        <span :class="compact ? 'hidden 2xl:inline' : ''">{{ de.plan.print }}</span>
      </UButton>
    </div>
  </div>
</template>
