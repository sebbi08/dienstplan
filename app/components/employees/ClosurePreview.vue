<script setup lang="ts">
import type { ClosurePreviewYearDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * „Schließzeiten als Urlaub“: what the facility's closures take from a person's leave, always two blocks (the year of
 * „gültig ab“ from that day on, and the whole coming year). In the create form from the typed values (`input`,
 * debounced; null = not complete yet), on the employee page from the stored ones (`employeeId`, reloaded when `stamp`
 * changes, e.g. after saving hours or entitlement). The server computes it as the booking would; nothing is written.
 */
const props = defineProps<{
  name: string
  employeeId?: number
  input?: { weeklyMinutes?: number; workdays: number; validFrom: string; vacationDays: number | null; carriedOverDays: number | null } | null
  stamp?: unknown
}>()

const preview = ref<ClosurePreviewYearDto[] | null>(null)
const who = computed(() => props.name.trim() || de.closurePreview.thisPerson)
let timer: ReturnType<typeof setTimeout> | undefined
let ticket = 0
/** Loads the preview, debounced while typing; a late answer for older values is dropped. */
function load() {
  clearTimeout(timer)
  const current = ++ticket
  const { employeeId, input } = props
  if (employeeId === undefined && !input) {
    preview.value = null
    return
  }
  timer = setTimeout(async () => {
    try {
      const answer = employeeId !== undefined
        ? await $fetch<ClosurePreviewYearDto[]>(`/api/employees/${employeeId}/closure-preview`)
        : await $fetch<ClosurePreviewYearDto[]>('/api/employees/closure-preview', { method: 'POST', body: input })
      if (current === ticket) preview.value = answer
    }
    catch {
      if (current === ticket) preview.value = null
    }
  }, employeeId !== undefined ? 0 : 300)
}
onMounted(load)
watch(() => [props.employeeId, JSON.stringify(props.input ?? null), props.stamp], load)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div v-if="preview" class="space-y-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950" aria-live="polite">
    <p class="font-medium">{{ de.closurePreview.title }}</p>
    <div v-for="block in preview" :key="block.year" class="space-y-0.5 border-t border-sky-100 pt-1.5 first-of-type:border-t-0 first-of-type:pt-0">
      <template v-if="block.hasClosures">
        <p>{{ de.closurePreview.facility(block.year, block.facilityDays) }}</p>
        <p>{{ de.closurePreview.person(who, block.personDays, formatDate(block.from)) }}</p>
        <p v-if="block.closureDaysWithoutLeave > 0">{{ de.closurePreview.withoutLeave(block.closureDaysWithoutLeave) }}</p>
        <p v-if="block.entitlementDays !== null">
          {{ de.closurePreview.free(block.entitlementDays, block.entitlementDays - block.personDays) }}
          <template v-if="block.carriedOverDays > 0">{{ de.closurePreview.carriedOver(block.carriedOverDays) }}</template>
        </p>
      </template>
      <p v-else>{{ de.closurePreview.noClosures(block.year) }}</p>
    </div>
  </div>
</template>
