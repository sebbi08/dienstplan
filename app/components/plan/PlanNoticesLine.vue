<script setup lang="ts">
import type { SetupChecklist } from '#shared/domain/setupChecklist'
import type { MonthPlanDto, ReleaseNotificationStatusDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'
import { noticesSummary, notificationCounts } from '~/utils/planCompact'

/**
 * One slim line above the plan for the Leitung (replaces the setup line and the notification list): „Was noch fehlt: 2
 * Punkte · Freigegeben am … von … · 5 benachrichtigt, 2 ungelesen“. A click opens it: the link to „Was noch fehlt“ in the
 * settings and who was told about changed duties at the latest release, and who has read it. Nothing while there is
 * nothing to say. `setup`: „Was noch fehlt“ (not in the plan editor at the tablet). Loaded after the plan (lazy, in the
 * browser), so it never slows it.
 */
const props = defineProps<{ plan: MonthPlanDto; setup?: boolean }>()
const t = de.planNotices
const { data: checklist } = useFetch<SetupChecklist>('/api/setup-checklist', {
  key: 'setup-checklist-plan', lazy: true, server: false, pick: ['open'], immediate: props.setup === true,
})
const released = computed(() => props.plan.release.releasedAt !== null)
const { data: notifications } = useFetch<ReleaseNotificationStatusDto[]>(() => `/api/plan/${props.plan.year}/${props.plan.month}/notifications`, {
  lazy: true, server: false, immediate: released.value, watch: false,
})
const setupOpen = computed(() => (props.setup ? checklist.value?.open.length ?? 0 : 0))
const rows = computed(() => (released.value ? notifications.value ?? [] : []))
const parts = computed(() => noticesSummary({
  setupOpen: setupOpen.value,
  release: props.plan.release.releasedAt ? { at: formatDateTime(props.plan.release.releasedAt), by: props.plan.release.releasedBy ?? '' } : null,
  notifications: rows.value.length ? notificationCounts(rows.value) : null,
}))
const open = ref(false)
const id = useId()
</script>

<template>
  <div v-if="parts.length" class="text-xs text-gray-600 print:hidden">
    <button
      type="button" class="inline-flex max-w-full items-start gap-1 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-sky-500"
      :aria-expanded="open" :aria-controls="id" :title="open ? t.collapse : t.expand" @click="open = !open"
    >
      <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0" aria-hidden="true" />
      <UIcon name="i-lucide-bell" class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0">{{ parts.join(' · ') }}</span>
    </button>
    <div v-show="open" :id="id" class="mt-1 space-y-1 pl-5">
      <p v-if="setupOpen > 0">
        <NuxtLink to="/admin/settings" class="inline-flex items-center gap-1.5 text-sm hover:underline">
          <UIcon name="i-lucide-list-checks" class="size-4 shrink-0" aria-hidden="true" />
          {{ de.setupChecklist.planLine(setupOpen) }}
        </NuxtLink>
      </p>
      <p v-if="rows.length" class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-medium">{{ de.notifications.statusTitle }}:</span>
        <span v-for="row in rows" :key="row.employeeId" class="inline-flex items-center gap-1">
          <UIcon
            :name="!row.hasAccount ? 'i-lucide-user-x' : row.readAt ? 'i-lucide-check-check' : 'i-lucide-mail'"
            :class="!row.hasAccount ? 'text-gray-400' : row.readAt ? 'text-green-600' : 'text-amber-600'" aria-hidden="true"
          />
          {{ row.name }} ({{ !row.hasAccount ? de.notifications.noAccount : row.readAt ? de.notifications.read : de.notifications.unread }})
        </span>
      </p>
    </div>
  </div>
</template>
