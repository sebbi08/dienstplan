<script setup lang="ts">
import { countsAsSick, STORED_LONG_ABSENCE_REASONS, type StoredLongAbsenceReason } from '#shared/domain/longAbsence'
import type { EmployeeLongAbsenceDto, LongAbsenceDto, LongAbsenceInput, LongAbsenceSaveDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { periodText } from '~/utils/longAbsence'

/**
 * „Längere Abwesenheit“ in the tab „Gesundheit“ (only with employees.sickness, never on the own page): Langzeitkrank,
 * Kur/Reha and Sonstiges entered here (reason, from, to or „bis auf Weiteres“), the Mutterschutz booked in the plan and
 * the full Elternzeit shown as taken over (changed where they are entered). At each entered period: what the plan still
 * holds in it – duties (removed only on „Dienste entfernen“, with plan.edit, never on a stamped day), leave entries and
 * open leave requests (no leave is used on sick days, § 9 BUrlG), stamped days – as long as it holds them. Health data:
 * loaded once the tab is opened; the server checks every request.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.longAbsence
const { data, status, error, execute, refresh } = useFetch<EmployeeLongAbsenceDto>(
  `/api/employees/${props.employeeId}/long-absences`, { server: false, immediate: false },
)
const { busy, run } = useBusyAction(() => refresh())
const confirm = useConfirm()
const toast = useToast()

onMounted(() => {
  watch(() => props.active, (active) => {
    if (active && status.value === 'idle') void execute()
  }, { immediate: true })
})

const loadError = computed(() => (error.value ? errorMessage(error.value) : null))

/** Where a period taken over is changed: the tab of the Mutterschutz or the Elternzeit. */
function sourceOf(item: LongAbsenceDto): { text: string; link: string; to: { query: { tab: string } } } | null {
  if (item.source === 'maternity') return { text: t.fromMaternity, link: t.toMaternity, to: { query: { tab: 'maternity' } } }
  if (item.source === 'parentalLeave') return { text: t.fromParentalLeave, link: t.toParentalLeave, to: { query: { tab: 'parentalLeave' } } }
  return null
}

const MAX_LINES = 8
/** Duties that „Dienste entfernen“ would remove (not on stamped days). */
const removable = (item: LongAbsenceDto) => (item.conflicts?.duties ?? []).filter(duty => !duty.stamped)
const hasConflicts = (item: LongAbsenceDto) => {
  const conflicts = item.conflicts
  return conflicts !== null && (conflicts.duties.length > 0 || conflicts.leave.length > 0 || conflicts.openRequests.length > 0 || conflicts.stampedDays > 0)
}

// ---- the form (new or changed) ----
interface Form { reason: StoredLongAbsenceReason; start: string; end: string }
const formOpen = ref(false)
const editing = ref<LongAbsenceDto | null>(null)
const form = reactive<Form>({ reason: 'sick', start: '', end: '' })
const reasonItems = STORED_LONG_ABSENCE_REASONS.map(value => ({ label: t.reasons[value], value }))

function openForm(item?: LongAbsenceDto) {
  editing.value = item ?? null
  Object.assign(form, item && item.source === 'entry'
    ? { reason: item.reason as StoredLongAbsenceReason, start: item.start, end: item.end ?? '' }
    : { reason: 'sick', start: '', end: '' })
  formOpen.value = true
}

const body = (): LongAbsenceInput => ({ reason: form.reason, start: form.start, end: form.end === '' ? null : form.end })

async function save() {
  if (!form.start) return
  const before = editing.value
  let result: LongAbsenceSaveDto | null = null
  const ok = await run(async () => {
    result = before?.id
      ? await $fetch<LongAbsenceSaveDto>(`/api/long-absences/${before.id}`, { method: 'PUT', body: body() })
      : await $fetch<LongAbsenceSaveDto>(`/api/employees/${props.employeeId}/long-absences`, { method: 'POST', body: body() })
  }, de.common.saved)
  if (!ok) return
  formOpen.value = false
  // What the plan still holds stands at the period from now on; a short note points at it.
  const saved = result as LongAbsenceSaveDto | null
  if (saved && (saved.duties.length || saved.leave.length || saved.openRequests.length)) toast.add({ title: t.conflictsToast, color: 'warning' })
}

async function removeDuties(item: LongAbsenceDto) {
  if (item.id === null) return
  let result = { removed: 0, keptStamped: 0 }
  const ok = await run(async () => {
    result = await $fetch<{ removed: number; keptStamped: number }>(`/api/long-absences/${item.id}/remove-duties`, { method: 'POST' })
  })
  if (!ok) return
  toast.add({ title: t.dutiesRemoved(result.removed), color: 'success' })
  if (result.keptStamped) toast.add({ title: t.dutiesKeptStamped(result.keptStamped), color: 'warning' })
}

async function remove(item: LongAbsenceDto) {
  if (item.id === null || !await confirm(t.removeConfirm, { confirmLabel: t.remove })) return
  await run(() => $fetch<{ ok: boolean }>(`/api/long-absences/${item.id}`, { method: 'DELETE' }), t.removed)
}
</script>

<template>
  <section class="space-y-4 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1 basis-64">
        <h2 class="font-semibold">{{ t.title }}</h2>
        <MoreHint class="text-sm text-gray-500" :text="t.intro" :more="t.introMore" />
      </div>
      <UButton v-if="data" icon="i-lucide-plus" :label="t.add" :disabled="busy" @click="openForm()" />
    </div>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
    <p v-else-if="!data" class="text-sm text-gray-500">{{ t.loading }}</p>
    <template v-else>
      <p v-if="!data.items.length" class="text-sm text-gray-600">{{ t.none }}</p>
      <ul v-else class="space-y-2">
        <li
          v-for="item in data.items" :key="`${item.source}-${item.id ?? item.start}`"
          class="space-y-2 rounded-md p-3 text-sm ring-1 ring-gray-200"
        >
          <div class="flex flex-wrap items-start gap-2">
            <div class="min-w-0 flex-1 space-y-0.5">
              <p class="font-medium">{{ t.reasons[item.reason] }}</p>
              <p>{{ periodText(item.start, item.end) }}</p>
              <p v-if="item.returnDay" class="text-gray-600">{{ t.returnLine(formatDate(item.returnDay)) }}</p>
              <p v-if="sourceOf(item)" class="text-xs text-gray-500">
                {{ sourceOf(item)!.text }} ·
                <NuxtLink :to="sourceOf(item)!.to" class="text-sky-700 hover:underline">{{ sourceOf(item)!.link }}</NuxtLink>
              </p>
              <p v-else-if="item.createdOn" class="text-xs text-gray-500">{{ t.createdBy(formatDate(item.createdOn), item.createdBy ?? '') }}</p>
              <p v-if="item.reason === 'other'" class="text-xs text-gray-500">{{ t.otherLeaveHint }}</p>
            </div>
            <div v-if="item.source === 'entry'" class="flex gap-1">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t.edit" :disabled="busy" @click="openForm(item)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t.remove" :disabled="busy" @click="remove(item)" />
            </div>
          </div>
          <!-- What the plan still holds in the period: shown as long as it holds it, nothing changes by itself. -->
          <div v-if="item.conflicts && hasConflicts(item)" class="space-y-2 rounded-md bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
            <template v-if="item.conflicts.duties.length">
              <p class="font-medium">{{ t.duties(item.conflicts.duties.length) }}</p>
              <ul class="space-y-0.5">
                <li v-for="duty in item.conflicts.duties.slice(0, MAX_LINES)" :key="duty.id">
                  {{ t.dutyLine(formatDate(duty.date), duty.label) }}<template v-if="duty.stamped"> · {{ t.dutyStamped }}</template>
                </li>
                <li v-if="item.conflicts.duties.length > MAX_LINES">…</li>
              </ul>
              <div v-if="data.canRemoveDuties && removable(item).length" class="flex flex-wrap items-center gap-2">
                <UButton size="sm" color="warning" icon="i-lucide-calendar-x" :label="t.removeDuties" :disabled="busy" @click="removeDuties(item)" />
                <span class="text-xs">{{ t.removeDutiesHint }}</span>
              </div>
              <p v-else-if="!data.canRemoveDuties" class="text-xs">{{ t.dutiesNoRight }}</p>
            </template>
            <template v-if="item.conflicts.leave.length">
              <p class="font-medium">{{ countsAsSick(item.reason) ? t.leaveSick(item.conflicts.leave.length) : t.leaveOther(item.conflicts.leave.length) }}</p>
              <ul class="space-y-0.5">
                <li v-for="(entry, index) in item.conflicts.leave.slice(0, MAX_LINES)" :key="index">{{ t.dutyLine(formatDate(entry.date), entry.label) }}</li>
                <li v-if="item.conflicts.leave.length > MAX_LINES">…</li>
              </ul>
            </template>
            <template v-if="item.conflicts.openRequests.length">
              <p class="font-medium">{{ t.openRequests(item.conflicts.openRequests.length) }}</p>
              <ul class="space-y-0.5">
                <li v-for="(request, index) in item.conflicts.openRequests" :key="index">
                  {{ periodText(request.from, request.to) }} · {{ t.requestKinds[request.kind] }}
                </li>
              </ul>
            </template>
            <p v-if="item.conflicts.stampedDays && countsAsSick(item.reason)" class="text-xs">{{ t.stampedDays(item.conflicts.stampedDays) }}</p>
          </div>
        </li>
      </ul>
    </template>

    <UModal v-model:open="formOpen" :title="editing === null ? t.add : t.editTitle">
      <template #body>
        <form class="grid gap-3" @submit.prevent="save">
          <UFormField :label="t.reason" :help="t.reasonHints[form.reason]" required>
            <USelect v-model="form.reason" :items="reasonItems" class="w-full sm:w-72" />
          </UFormField>
          <p class="text-xs text-gray-500">{{ t.takenOverHint }}</p>
          <div class="flex flex-wrap gap-3">
            <UFormField :label="t.start" required>
              <DateTextInput v-model="form.start" :label="t.start" required class="w-44" />
            </UFormField>
            <UFormField :label="t.end" :help="t.endHint">
              <DateTextInput v-model="form.end" :label="t.end" :min="form.start || undefined" class="w-44" />
            </UFormField>
          </div>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !form.start" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="formOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
