<script setup lang="ts">
import { STORED_LONG_ABSENCE_REASONS, type StoredLongAbsenceReason } from '#shared/domain/longAbsence'
import type { EmployeeLongAbsenceDto, LongAbsenceDto, LongAbsenceDutyDto, LongAbsenceInput, LongAbsenceSaveDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { periodText } from '~/utils/longAbsence'

/**
 * „Längere Abwesenheit“ in the tab „Gesundheit“ (only with employees.sickness, never on the own page): Langzeitkrank,
 * Kur/Reha and Sonstiges entered here (reason, from, to or „bis auf Weiteres“), the Mutterschutz booked in the plan and
 * the full Elternzeit shown as taken over (changed where they are entered). Duties still planned in a saved period are
 * named and removed only when the Leitung says so (with plan.edit). Health data: loaded once the tab is opened; the
 * server checks every request.
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

/** Duties still planned in the period just saved: named with the question whether they go (never removed silently). */
const pending = ref<{ id: number; duties: LongAbsenceDutyDto[] } | null>(null)
const shownDuties = computed(() => (pending.value?.duties ?? []).slice(0, 8))

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
  const saved = result as LongAbsenceSaveDto | null
  pending.value = saved && saved.duties.length > 0 ? saved : null
}

async function removeDuties() {
  const target = pending.value
  if (!target) return
  let removed = 0
  const ok = await run(async () => {
    removed = (await $fetch<{ removed: number }>(`/api/long-absences/${target.id}/remove-duties`, { method: 'POST' })).removed
  })
  if (!ok) return
  pending.value = null
  toast.add({ title: t.dutiesRemoved(removed), color: 'success' })
}

async function remove(item: LongAbsenceDto) {
  if (item.id === null || !await confirm(t.removeConfirm, { confirmLabel: t.remove })) return
  if (await run(() => $fetch<{ ok: boolean }>(`/api/long-absences/${item.id}`, { method: 'DELETE' }), t.removed)) {
    if (pending.value?.id === item.id) pending.value = null
  }
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
      <!-- Duties left in the period just saved: removed only on „Dienste entfernen“ (plan.edit), else named. -->
      <UAlert v-if="pending" color="warning" variant="soft" :title="t.duties(pending.duties.length)">
        <template #description>
          <ul class="mt-1 space-y-0.5">
            <li v-for="duty in shownDuties" :key="duty.id">{{ t.dutyLine(formatDate(duty.date), duty.label) }}</li>
            <li v-if="pending.duties.length > shownDuties.length">…</li>
          </ul>
          <p class="mt-2">{{ data.canRemoveDuties ? t.dutiesQuestion : t.dutiesNoRight }}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton
              v-if="data.canRemoveDuties" size="sm" color="warning" icon="i-lucide-calendar-x" :label="t.removeDuties" :disabled="busy"
              @click="removeDuties"
            />
            <UButton size="sm" color="neutral" variant="outline" :label="t.keepDuties" :disabled="busy" @click="pending = null" />
          </div>
        </template>
      </UAlert>
      <p v-if="!data.items.length" class="text-sm text-gray-600">{{ t.none }}</p>
      <ul v-else class="space-y-2">
        <li
          v-for="item in data.items" :key="`${item.source}-${item.id ?? item.start}`"
          class="flex flex-wrap items-start gap-2 rounded-md p-3 text-sm ring-1 ring-gray-200"
        >
          <div class="min-w-0 flex-1 space-y-0.5">
            <p class="font-medium">{{ t.reasons[item.reason] }}</p>
            <p>{{ periodText(item.start, item.end) }}</p>
            <p v-if="item.returnDay" class="text-gray-600">{{ t.returnLine(formatDate(item.returnDay)) }}</p>
            <p v-if="sourceOf(item)" class="text-xs text-gray-500">
              {{ sourceOf(item)!.text }} ·
              <NuxtLink :to="sourceOf(item)!.to" class="text-sky-700 hover:underline">{{ sourceOf(item)!.link }}</NuxtLink>
            </p>
            <p v-else-if="item.createdOn" class="text-xs text-gray-500">{{ t.createdBy(formatDate(item.createdOn), item.createdBy ?? '') }}</p>
          </div>
          <div v-if="item.source === 'entry'" class="flex gap-1">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t.edit" :disabled="busy" @click="openForm(item)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t.remove" :disabled="busy" @click="remove(item)" />
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
