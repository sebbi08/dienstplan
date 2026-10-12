<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { EARLIEST_REQUIREMENT_DATE, type RequirementState } from '#shared/domain/requirements'
import type { EmployeeRequirementKindDto, EmployeeRequirementsDto, RequirementRecordDto, TrainingDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { intervalText } from '~/utils/requirements'

/**
 * Mandatory appointments and trainings of one employee, for Leitung and Träger: per kind the newest record, the due
 * date and the state, with "Eintragen" and the history; below, the list of trainings.
 */
const props = defineProps<{ employeeId: number }>()
const { data, refresh } = await useFetch<EmployeeRequirementsDto>(`/api/employees/${props.employeeId}/requirements`)
const run = useAction(refresh)
const confirm = useConfirm()

const STATE_BADGE: Record<RequirementState, { color: 'error' | 'warning' | 'success'; variant: 'soft' | 'outline' }> = {
  overdue: { color: 'error', variant: 'soft' },
  missing: { color: 'error', variant: 'outline' },
  soon: { color: 'warning', variant: 'soft' },
  ok: { color: 'success', variant: 'soft' },
}

// One "Eintragen" form at a time, under the row of its kind. Only what has happened is entered: no date after today.
const entry = reactive<{ typeId: number | null; date: string; note: string }>({ typeId: null, date: todayIso(), note: '' })
function openEntry(kind: EmployeeRequirementKindDto) {
  Object.assign(entry, { typeId: kind.type.id, date: todayIso(), note: '' })
}
async function saveEntry() {
  if (entry.typeId === null) return
  const body = { typeId: entry.typeId, date: entry.date, note: entry.note || null }
  if (await run(() => $fetch<unknown>(`/api/employees/${props.employeeId}/requirements`, { method: 'POST', body }), de.common.saved)) {
    entry.typeId = null
  }
}

/** Kinds whose history is shown. */
const historyOpen = ref<number[]>([])
function toggleHistory(typeId: number) {
  historyOpen.value = historyOpen.value.includes(typeId) ? historyOpen.value.filter(id => id !== typeId) : [...historyOpen.value, typeId]
}
async function deleteRecord(kind: EmployeeRequirementKindDto, record: RequirementRecordDto) {
  if (await confirm(de.requirements.deleteRecordConfirm(kind.type.name, formatDate(record.date)))) {
    run(() => $fetch<unknown>(`/api/employee-requirements/${record.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}

// Trainings may lie ahead (a booked course), so only the year is kept within reason.
const LATEST_TRAINING_DATE = '2100-12-31'
const emptyTraining = () => ({ id: null as number | null, date: todayIso(), title: '', note: '' })
const training = reactive(emptyTraining())
function editTraining(item: TrainingDto) {
  Object.assign(training, { id: item.id, date: item.date, title: item.title, note: item.note ?? '' })
}
function resetTraining() {
  Object.assign(training, emptyTraining())
}
async function saveTraining() {
  const body = { date: training.date, title: training.title, note: training.note || null }
  const { id } = training
  const ok = await run(() => id === null
    ? $fetch<unknown>(`/api/employees/${props.employeeId}/trainings`, { method: 'POST', body })
    : $fetch<unknown>(`/api/employee-trainings/${id}`, { method: 'PUT', body }), de.common.saved)
  if (ok) resetTraining()
}
async function deleteTraining(item: TrainingDto) {
  if (!await confirm(de.requirements.deleteTrainingConfirm(item.title))) return
  if (await run(() => $fetch<unknown>(`/api/employee-trainings/${item.id}`, { method: 'DELETE' }), de.common.deleted) && training.id === item.id) {
    resetTraining()
  }
}
</script>

<template>
  <section v-if="data" id="requirements" class="scroll-mt-32 space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.requirements.title }}</h2>
    <p class="text-xs text-gray-500">{{ de.requirements.hint }}</p>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th class="py-1 pr-3">{{ de.requirements.kind }}</th><th class="py-1 pr-3">{{ de.requirements.interval }}</th>
            <th class="py-1 pr-3">{{ de.requirements.lastDate }}</th><th class="py-1 pr-3">{{ de.requirements.dueOn }}</th>
            <th class="py-1 pr-3">{{ de.requirements.state }}</th><th />
          </tr>
        </thead>
        <tbody>
          <template v-for="kind in data.kinds" :key="kind.type.id">
            <tr class="border-t border-gray-100">
              <td class="py-1.5 pr-3 font-medium">{{ kind.type.name }}</td>
              <td class="whitespace-nowrap py-1.5 pr-3 text-gray-600">{{ intervalText(kind.type.intervalMonths) }}</td>
              <td class="whitespace-nowrap py-1.5 pr-3">{{ kind.lastDate ? formatDate(kind.lastDate) : de.requirements.none }}</td>
              <td class="whitespace-nowrap py-1.5 pr-3">{{ kind.dueOn ? formatDate(kind.dueOn) : de.requirements.none }}</td>
              <td class="py-1.5 pr-3">
                <UBadge :color="STATE_BADGE[kind.state].color" :variant="STATE_BADGE[kind.state].variant" :label="de.requirements.states[kind.state]" />
              </td>
              <td class="whitespace-nowrap py-1.5 text-right">
                <UButton
                  v-if="kind.records.length" size="xs" color="neutral" variant="ghost"
                  :trailing-icon="historyOpen.includes(kind.type.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  :label="de.requirements.history(kind.records.length)" :aria-expanded="historyOpen.includes(kind.type.id)"
                  :title="historyOpen.includes(kind.type.id) ? de.requirements.hideHistory : de.requirements.showHistory"
                  @click="toggleHistory(kind.type.id)"
                />
                <UButton
                  size="xs" color="neutral" variant="outline" icon="i-lucide-plus" :label="de.requirements.enter"
                  :aria-label="de.requirements.enterFor(kind.type.name)" @click="openEntry(kind)"
                />
              </td>
            </tr>
            <tr v-if="entry.typeId === kind.type.id">
              <td colspan="6" class="pb-3">
                <form class="flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3" @submit.prevent="saveEntry">
                  <p class="w-full text-sm font-medium">{{ de.requirements.enterFor(kind.type.name) }}</p>
                  <UFormField :label="de.requirements.date">
                    <UInput v-model="entry.date" type="date" :min="EARLIEST_REQUIREMENT_DATE" :max="todayIso()" required />
                  </UFormField>
                  <UFormField :label="de.requirements.note" class="min-w-48 flex-1">
                    <UInput v-model="entry.note" maxlength="200" class="w-full" />
                  </UFormField>
                  <UButton type="submit" :label="de.requirements.enter" />
                  <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="entry.typeId = null" />
                </form>
              </td>
            </tr>
            <tr v-if="historyOpen.includes(kind.type.id) && kind.records.length">
              <td colspan="6" class="pb-3">
                <ul class="divide-y divide-gray-100 rounded-md bg-gray-50 px-3">
                  <li v-for="record in kind.records" :key="record.id" class="flex items-center gap-3 py-1">
                    <span class="whitespace-nowrap">{{ formatDate(record.date) }}</span>
                    <span class="flex-1 text-gray-600">{{ record.note }}</span>
                    <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteRecord(kind, record)" />
                  </li>
                </ul>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <h3 class="pt-2 text-sm font-semibold">{{ de.requirements.trainings }}</h3>
    <p v-if="data.trainings.length === 0" class="text-sm text-gray-500">{{ de.requirements.noTrainings }}</p>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <tbody>
          <tr v-for="item in data.trainings" :key="item.id" class="border-t border-gray-100" :class="training.id === item.id ? 'bg-sky-50' : ''">
            <td class="w-28 whitespace-nowrap py-1 pr-3">{{ formatDate(item.date) }}</td>
            <td class="py-1 pr-3 font-medium">{{ item.title }}</td>
            <td class="py-1 pr-3 text-gray-600">{{ item.note }}</td>
            <td class="whitespace-nowrap py-1 text-right">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="editTraining(item)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteTraining(item)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveTraining">
      <p v-if="training.id !== null" class="w-full text-sm font-medium">{{ de.requirements.editTraining }}</p>
      <UFormField :label="de.requirements.date">
        <UInput v-model="training.date" type="date" :min="EARLIEST_REQUIREMENT_DATE" :max="LATEST_TRAINING_DATE" required />
      </UFormField>
      <UFormField :label="de.requirements.trainingTitle" class="min-w-48 flex-1">
        <UInput v-model="training.title" maxlength="200" :placeholder="de.requirements.trainingTitlePlaceholder" class="w-full" required />
      </UFormField>
      <UFormField :label="de.requirements.note" class="min-w-48 flex-1">
        <UInput v-model="training.note" maxlength="500" class="w-full" />
      </UFormField>
      <UButton v-if="training.id === null" type="submit" icon="i-lucide-plus" :label="de.requirements.addTraining" />
      <template v-else>
        <UButton type="submit" :label="de.common.save" />
        <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="resetTraining" />
      </template>
    </form>
  </section>
</template>
