<script setup lang="ts">
import {
  BEM_ANSWERS, BEM_LIMITS, BEM_MEASURE_STATUSES, BEM_STEP_KINDS, bemAnswerBy, bemSickLevel, type BemAnswer, type BemMeasureStatus,
  type BemStepKind,
} from '#shared/domain/bem'
import { todayIso } from '#shared/domain/dates'
import type { BemProcessDto, BemStepDto, EmployeeBemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „BEM“ in the tab „Gesundheit“ (only with employees.sickness, never on the own page): the line „Krankheitstage letzte
 * 12 Monate: ‹n› von ‹Grenze›“ (amber from 80 %, red above), the running BEM (invitation to print, „Verschickt am“,
 * the answer, talks, measures and notes, „Abschließen“) or „BEM einleiten“, and the earlier ones read-only. Health
 * data: loaded in the browser once the tab is opened; the server checks every request.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.bem
const { data, status, error, execute, refresh } = useFetch<EmployeeBemDto>(
  `/api/employees/${props.employeeId}/bem`, { server: false, immediate: false },
)
const { busy, run } = useBusyAction(() => refresh())
const confirm = useConfirm()

onMounted(() => {
  watch(() => props.active, (active) => {
    if (active && status.value === 'idle') void execute()
  }, { immediate: true })
})

const loadError = computed(() => (error.value ? errorMessage(error.value) : null))
const level = computed(() => (data.value ? bemSickLevel(data.value.sickDays.days, data.value.sickDays.limit) : 'ok'))
const levelClass = computed(() => ({
  ok: 'bg-gray-50 text-gray-800', warn: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200', over: 'bg-red-50 text-red-800 ring-1 ring-red-200',
}[level.value]))
const open = computed(() => data.value?.open ?? null)
const today = todayIso()

const start = () => run(() => $fetch<{ id: number }>(`/api/employees/${props.employeeId}/bem`, { method: 'POST' }), t.started)

/** The invitation opens in a new tab (A4 portrait, PDF or print). */
const invitationPath = (process: BemProcessDto) => `/admin/print/bem-invitation/${process.id}`

// „Verschickt am“, the answer and the completion of the running BEM, each with its own date field.
const sentOn = ref('')
const answer = reactive<{ value: BemAnswer; date: string }>({ value: 'accepted', date: today })
const ending = ref(today)
const withdrawn = ref(today)
watch(open, (process) => {
  sentOn.value = process?.invitedOn ?? today
  Object.assign(answer, { value: 'accepted', date: today })
  ending.value = today
  withdrawn.value = today
}, { immediate: true })
/**
 * The answers on offer once „Verschickt am“ is saved (the form shows only then; the server checks the same): „keine
 * Antwort“ only from the day the answer was asked by.
 */
const answerItems = computed(() => BEM_ANSWERS
  .filter(value => value !== 'no_answer' || (open.value?.invitedOn != null && bemAnswerBy(open.value.invitedOn) <= today))
  .map(value => ({ label: t.answers[value], value })))

const saveSent = (process: BemProcessDto) => sentOn.value
  && run(() => $fetch<{ ok: boolean }>(`/api/bem/${process.id}/sent`, { method: 'PUT', body: { invitedOn: sentOn.value } }), de.common.saved)
const saveAnswer = (process: BemProcessDto) => answer.date
  && run(() => $fetch<{ ok: boolean }>(`/api/bem/${process.id}/answer`, { method: 'PUT', body: { answer: answer.value, date: answer.date } }), de.common.saved)

async function withdraw(process: BemProcessDto) {
  if (!withdrawn.value || !await confirm(t.withdrawConfirm, { confirmLabel: t.withdraw })) return
  await run(() => $fetch<{ ok: boolean }>(`/api/bem/${process.id}/answer`, { method: 'PUT', body: { answer: 'declined', date: withdrawn.value } }), de.common.saved)
}
/** „Gesprächsnotizen löschen“ of a declined BEM: the texts of its talks and measures go, dates and status stay. */
async function clearNotes(process: BemProcessDto) {
  if (!await confirm(t.clearNotesConfirm, { confirmLabel: t.clearNotes })) return
  await run(() => $fetch<{ cleared: number }>(`/api/bem/${process.id}/clear-notes`, { method: 'POST' }), t.clearedNotes)
}
/** A declined BEM (e.g. after a withdrawn consent) with texts left in its steps. */
const hasNotes = (process: BemProcessDto) => process.status === 'declined'
  && process.steps.some(item => item.text !== '' || item.participants !== '')
/** Talks and measures only after the consent; a note also before. */
const stepKinds = computed(() => BEM_STEP_KINDS.filter(kind => kind === 'note' || open.value?.status === 'accepted'))
async function complete(process: BemProcessDto) {
  if (!ending.value || !await confirm(t.completeConfirm, { confirmLabel: t.complete, danger: false })) return
  await run(() => $fetch<{ ok: boolean }>(`/api/bem/${process.id}/complete`, { method: 'PUT', body: { date: ending.value } }), de.common.saved)
}
async function remove(process: BemProcessDto) {
  if (!await confirm(t.removeConfirm, { confirmLabel: t.remove })) return
  await run(() => $fetch<{ ok: boolean }>(`/api/bem/${process.id}`, { method: 'DELETE' }), t.removed)
}

// The dialog for a talk, measure or note (new or changed).
const stepOpen = ref(false)
const stepEditing = ref<number | null>(null)
const step = reactive<{ kind: BemStepKind; date: string; participants: string; text: string; status: BemMeasureStatus }>({
  kind: 'meeting', date: today, participants: '', text: '', status: 'planned',
})
const statusItems = BEM_MEASURE_STATUSES.map(value => ({ label: t.measureStatus[value], value }))
function openStep(kind: BemStepKind, existing?: BemStepDto) {
  stepEditing.value = existing?.id ?? null
  Object.assign(step, existing
    ? { kind, date: existing.date, participants: existing.participants, text: existing.text, status: existing.status ?? 'planned' }
    : { kind, date: today, participants: '', text: '', status: 'planned' })
  stepOpen.value = true
}
async function saveStep(process: BemProcessDto) {
  if (!step.date) return
  const body = { date: step.date, participants: step.participants, text: step.text, status: step.kind === 'measure' ? step.status : null }
  const request = stepEditing.value === null
    ? () => $fetch<{ id: number }>(`/api/bem/${process.id}/steps`, { method: 'POST', body: { ...body, kind: step.kind } })
    : () => $fetch<{ ok: boolean }>(`/api/bem-steps/${stepEditing.value}`, { method: 'PUT', body })
  if (await run(request, de.common.saved)) stepOpen.value = false
}
async function removeStep(item: BemStepDto) {
  if (!await confirm(t.deleteStepConfirm, { confirmLabel: t.deleteStep })) return
  await run(() => $fetch<{ ok: boolean }>(`/api/bem-steps/${item.id}`, { method: 'DELETE' }), de.common.deleted)
}

/** „abgeschlossen am …“, „abgelehnt am …“, „keine Antwort am …“. */
const endedLine = (process: BemProcessDto) => t.ended(t.status[process.status], process.completedOn ? formatDate(process.completedOn) : '')
const stepLabel = (item: BemStepDto) => (item.kind === 'measure' && item.status ? `${t.kinds.measure} (${t.measureStatus[item.status]})` : t.kinds[item.kind])
</script>

<template>
  <section class="space-y-4 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div>
      <h2 class="font-semibold">{{ t.title }}</h2>
      <MoreHint class="text-sm text-gray-500" :text="t.intro" :more="t.introMore" />
    </div>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
    <p v-else-if="!data" class="text-sm text-gray-500">{{ t.loading }}</p>
    <template v-else>
      <div class="space-y-1 rounded-md px-3 py-2 text-sm" :class="levelClass">
        <p class="font-medium">{{ t.sickDays(data.sickDays.days, data.sickDays.limit) }}</p>
        <p v-if="level === 'over' && !open">{{ t.over }}</p>
        <p class="text-xs opacity-80">{{ t.sickDaysHint(data.sickDays.workdaysPerWeek) }}</p>
        <p v-if="data.sickDays.restartAfter" class="text-xs opacity-80">{{ t.restarted(formatDate(data.sickDays.from)) }}</p>
      </div>

      <div v-if="!open" class="flex flex-wrap items-center gap-3">
        <p class="text-sm text-gray-600">{{ t.none }}</p>
        <UButton icon="i-lucide-play" :label="t.start" :loading="busy" :disabled="busy" @click="start" />
      </div>

      <div v-else class="space-y-4 rounded-md p-3 ring-1 ring-sky-200">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-semibold">{{ t.current }}</h3>
          <span class="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{{ t.status[open.status] }}</span>
          <span class="text-xs text-gray-500">{{ t.createdBy(formatDate(open.createdOn), open.createdBy) }}</span>
          <UButton
            class="ml-auto" size="sm" color="neutral" variant="outline" icon="i-lucide-printer" :label="t.printInvitation"
            :to="invitationPath(open)" target="_blank"
          />
        </div>

        <!-- Invited: „Verschickt am“ and the answer. -->
        <template v-if="open.status === 'invited'">
          <p class="text-sm text-gray-700">
            {{ open.invitedOn ? t.sentLine(formatDate(open.invitedOn), formatDate(bemAnswerBy(open.invitedOn))) : t.notSent }}
          </p>
          <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveSent(open)">
            <UFormField :label="t.sentOn"><DateTextInput v-model="sentOn" :label="t.sentOn" :max="today" required class="w-44" /></UFormField>
            <UButton type="submit" color="neutral" variant="outline" :label="t.sentSave" :disabled="busy || !sentOn" />
          </form>
          <template v-if="open.invitedOn">
            <form class="flex flex-wrap items-end gap-2" @submit.prevent="saveAnswer(open)">
              <UFormField :label="t.answer"><USelect v-model="answer.value" :items="answerItems" class="w-44" /></UFormField>
              <UFormField :label="t.answerDate">
                <DateTextInput v-model="answer.date" :label="t.answerDate" :min="open.invitedOn" :max="today" required class="w-44" />
              </UFormField>
              <UButton type="submit" :label="t.saveAnswer" :disabled="busy || !answer.date" />
            </form>
            <p class="text-xs text-gray-500">{{ t.answerHint }}</p>
          </template>
          <p v-else class="text-xs text-gray-500">{{ t.answerAfterSent }}</p>
        </template>
        <p v-else-if="open.answeredOn" class="text-sm text-gray-700">{{ t.acceptedLine(formatDate(open.answeredOn)) }}</p>

        <!-- Talks, measures and notes. -->
        <div class="space-y-2">
          <p v-if="!open.steps.length" class="text-sm text-gray-500">{{ t.noSteps }}</p>
          <ul v-else class="divide-y divide-gray-100 text-sm">
            <li v-for="item in open.steps" :key="item.id" class="flex flex-wrap items-start gap-3 py-2">
              <div class="min-w-0 flex-1 space-y-0.5">
                <p><span class="font-medium">{{ formatDate(item.date) }}</span> · {{ stepLabel(item) }}</p>
                <p v-if="item.participants" class="text-gray-600">{{ t.participants }}: {{ item.participants }}</p>
                <p v-if="item.text" class="whitespace-pre-line break-words text-gray-700">{{ item.text }}</p>
              </div>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t.editStep" :disabled="busy" @click="openStep(item.kind, item)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t.deleteStep" :disabled="busy" @click="removeStep(item)" />
            </li>
          </ul>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="kind in stepKinds" :key="kind" size="sm" color="neutral" variant="outline" icon="i-lucide-plus"
              :label="t.add[kind]" :disabled="busy" @click="openStep(kind)"
            />
          </div>
          <p v-if="open.status !== 'accepted'" class="text-xs text-gray-500">{{ t.beforeConsent }}</p>
        </div>

        <!-- Ending: „Abschließen“ (accepted), „Zustimmung widerrufen“, or deleting one started by mistake. -->
        <div class="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <template v-if="open.status === 'accepted'">
            <form class="flex flex-wrap items-end gap-2" @submit.prevent="complete(open)">
              <UFormField :label="t.completeDate"><DateTextInput v-model="ending" :label="t.completeDate" :max="today" required class="w-44" /></UFormField>
              <UButton type="submit" icon="i-lucide-check" :label="t.complete" :disabled="busy || !ending" />
            </form>
            <form class="flex flex-wrap items-end gap-2" @submit.prevent="withdraw(open)">
              <UFormField :label="t.withdrawDate"><DateTextInput v-model="withdrawn" :label="t.withdrawDate" :max="today" required class="w-44" /></UFormField>
              <UButton type="submit" color="neutral" variant="outline" :label="t.withdraw" :disabled="busy || !withdrawn" />
            </form>
          </template>
          <!-- Only while the invitation is not sent: afterwards the offer is the evidence. -->
          <UButton
            v-else-if="!open.invitedOn" class="ml-auto" size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.remove"
            :disabled="busy" @click="remove(open)"
          />
        </div>
      </div>

      <div v-if="data.history.length" class="space-y-2">
        <h3 class="font-semibold">{{ t.history }}</h3>
        <details v-for="process in data.history" :key="process.id" class="rounded-md p-3 text-sm ring-1 ring-gray-200">
          <summary class="cursor-pointer">
            <span class="font-medium">{{ endedLine(process) }}</span>
            <span class="text-gray-500"> · {{ t.createdBy(formatDate(process.createdOn), process.createdBy) }}</span>
          </summary>
          <div class="mt-2 space-y-1">
            <p v-if="process.invitedOn" class="text-gray-600">{{ t.sentOn }}: {{ formatDate(process.invitedOn) }}</p>
            <p v-if="process.answeredOn" class="text-gray-600">{{ t.answer }}: {{ formatDate(process.answeredOn) }}</p>
            <p v-if="!process.steps.length" class="text-gray-500">{{ t.noSteps }}</p>
            <ul v-else class="divide-y divide-gray-100">
              <li v-for="item in process.steps" :key="item.id" class="py-1.5">
                <p><span class="font-medium">{{ formatDate(item.date) }}</span> · {{ stepLabel(item) }}</p>
                <p v-if="item.participants" class="text-gray-600">{{ t.participants }}: {{ item.participants }}</p>
                <p v-if="item.text" class="whitespace-pre-line break-words text-gray-700">{{ item.text }}</p>
              </li>
            </ul>
            <div v-if="hasNotes(process)" class="flex flex-wrap items-center gap-2 pt-2">
              <p class="text-xs text-gray-600">{{ t.clearNotesHint }}</p>
              <UButton size="xs" color="error" variant="outline" icon="i-lucide-eraser" :label="t.clearNotes" :disabled="busy" @click="clearNotes(process)" />
            </div>
          </div>
        </details>
      </div>
    </template>

    <UModal v-if="open" v-model:open="stepOpen" :title="stepEditing === null ? t.add[step.kind] : t.kinds[step.kind]">
      <template #body>
        <form class="grid gap-3" @submit.prevent="saveStep(open)">
          <UFormField :label="t.date" required><DateTextInput v-model="step.date" :label="t.date" required class="w-44" /></UFormField>
          <UFormField v-if="step.kind === 'meeting'" :label="t.participants">
            <UInput v-model="step.participants" :maxlength="BEM_LIMITS.participants" :placeholder="t.participantsPlaceholder" class="w-full" />
          </UFormField>
          <UFormField v-if="step.kind === 'measure'" :label="t.measureStatusLabel">
            <USelect v-model="step.status" :items="statusItems" class="w-44" />
          </UFormField>
          <UFormField :label="step.kind === 'meeting' ? t.notes : step.kind === 'measure' ? t.measureText : t.text" :required="step.kind !== 'meeting'">
            <UTextarea v-model="step.text" :rows="4" :maxlength="BEM_LIMITS.text" autoresize class="w-full" :required="step.kind !== 'meeting'" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !step.date" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="stepOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
