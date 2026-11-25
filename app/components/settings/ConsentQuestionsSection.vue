<script setup lang="ts">
import { CONSENT_AREA_MAX, CONSENT_SHORT_MAX, CONSENT_TEXT_MAX, consentAreas, groupByArea } from '#shared/domain/childConsents'
import type { ConsentQuestionInput, ConsentQuestionSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { moveArea, moveQuestion } from '~/utils/consentSettings'
import type { RowAction } from '~/utils/rowActions'

/**
 * The facility's consent questions (Einwilligungen & Erlaubnisse) by area: add, change text, short name and area,
 * reorder, hide and show. A question with answers can only be hidden (the answers stay as proof); one without can be
 * deleted. The server checks the same.
 */
const s = de.consentSettings
const NEW_AREA = '\u0000new'
// The record and the overview read the questions too.
const REFRESH = ['children-overview', 'settings-overview-sheets']

const { data, refresh } = await useFetch<ConsentQuestionSettingsDto[]>('/api/child-consent-questions', { key: 'settings-consent-questions' })
const { busy, run } = useBusyAction(async () => {
  await Promise.all([refresh(), refreshNuxtData(REFRESH)])
})
const confirm = useConfirm()

const questions = computed(() => data.value ?? [])
const blocks = computed(() => groupByArea(questions.value))
const areas = computed(() => consentAreas(questions.value))

/** The question being edited (its id), a new one ('new') or none. */
const editing = ref<number | 'new' | null>(null)
const form = reactive({ text: '', short: '', area: '', newArea: '' })
const areaItems = computed(() => [...areas.value.map(area => ({ label: area, value: area })), { label: s.newArea, value: NEW_AREA }])
useDirty(() => editing.value !== null)

function startEdit(question: ConsentQuestionSettingsDto | null) {
  editing.value = question?.id ?? 'new'
  Object.assign(form, {
    text: question?.text ?? '', short: question?.short ?? '', area: question?.area ?? areas.value[0] ?? NEW_AREA, newArea: '',
  })
}
function cancel() {
  editing.value = null
}

async function save() {
  const target = editing.value
  if (target === null) return
  const question = target === 'new' ? null : questions.value.find(entry => entry.id === target)
  const body: ConsentQuestionInput = {
    text: form.text, short: form.short, area: form.area === NEW_AREA ? form.newArea : form.area, ...(question ? { hidden: question.hidden } : {}),
  }
  const ok = await run(() => target === 'new'
    ? $fetch<unknown>('/api/child-consent-questions', { method: 'POST', body })
    : $fetch<unknown>(`/api/child-consent-questions/${target}`, { method: 'PUT', body }), de.common.saved)
  if (ok) editing.value = null
}

function setHidden(question: ConsentQuestionSettingsDto, hidden: boolean) {
  const body: ConsentQuestionInput = { text: question.text, short: question.short, area: question.area, hidden }
  run(() => $fetch<unknown>(`/api/child-consent-questions/${question.id}`, { method: 'PUT', body }), de.common.saved)
}

async function remove(question: ConsentQuestionSettingsDto) {
  if (await confirm(s.confirmDelete)) run(() => $fetch<unknown>(`/api/child-consent-questions/${question.id}`, { method: 'DELETE' }), de.common.deleted)
}

/** The ▲/▼ show only after „Reihenfolge ändern“. */
const reordering = ref(false)
/** „Bearbeiten“, „Ausblenden“/„Einblenden“, „Löschen“ (only without answers; with answers disabled, saying why). */
const actionsOf = (question: ConsentQuestionSettingsDto): RowAction[] => [
  { key: 'edit', label: de.common.edit, icon: 'i-lucide-pencil', disabled: busy.value, onClick: () => startEdit(question) },
  {
    key: 'hide', label: question.hidden ? s.show : s.hide, icon: question.hidden ? 'i-lucide-eye' : 'i-lucide-eye-off', disabled: busy.value,
    onClick: () => setHidden(question, !question.hidden),
  },
  {
    key: 'delete', label: de.common.delete, icon: 'i-lucide-trash-2', color: question.answerCount ? 'neutral' : 'error', variant: 'ghost',
    iconOnly: true, disabled: busy.value || question.answerCount > 0, title: question.answerCount ? s.hideInsteadHint : undefined,
    onClick: () => remove(question),
  },
]
function reorder(ids: number[] | null) {
  if (ids) run(() => $fetch<unknown>('/api/child-consent-questions/order', { method: 'POST', body: { ids } }), de.common.saved)
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ s.title }}</h2>
      <ReorderToggle v-if="questions.length > 1" v-model="reordering" size="xs" class="ml-auto" />
    </div>
    <p class="text-xs text-gray-500">{{ s.intro }} {{ s.hiddenHint }}</p>
    <p v-if="!questions.length" class="text-sm text-gray-500">{{ s.empty }}</p>

    <div v-for="(block, blockIndex) in blocks" :key="block.area" class="space-y-1">
      <div class="flex items-center gap-1">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.area }}</h3>
        <template v-if="reordering">
          <UButton
            color="neutral" variant="ghost" icon="i-lucide-chevron-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${s.areaUp}: ${block.area}`"
            :disabled="busy || blockIndex === 0" @click="reorder(moveArea(questions, block.area, -1))"
          />
          <UButton
            color="neutral" variant="ghost" icon="i-lucide-chevron-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${s.areaDown}: ${block.area}`"
            :disabled="busy || blockIndex === blocks.length - 1" @click="reorder(moveArea(questions, block.area, 1))"
          />
        </template>
      </div>
      <ul class="divide-y divide-gray-100 text-sm">
        <li v-for="(question, index) in block.questions" :key="question.id" class="flex flex-wrap items-center gap-2 py-1.5">
          <div class="min-w-48 flex-1" :class="question.hidden ? 'text-gray-500' : ''">
            <span>{{ question.text }}</span>
            <span class="ml-2 text-xs text-gray-500">{{ s.short }}: {{ question.short }}</span>
            <UBadge v-if="question.hidden" class="ml-2" size="sm" color="neutral" variant="soft" :label="s.hidden" />
            <span v-if="question.answerCount" class="ml-2 text-xs text-gray-500">{{ s.answers(question.answerCount) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <!-- ▲/▼ only after „Reihenfolge ändern“; on phones „Bearbeiten“ and „⋯“ with the rest. -->
            <template v-if="reordering">
              <UButton
                color="neutral" variant="ghost" icon="i-lucide-arrow-up" class="min-h-10 min-w-10 justify-center" :aria-label="`${s.moveUp}: ${question.text}`"
                :disabled="busy || index === 0" @click="reorder(moveQuestion(questions, question.id, -1))"
              />
              <UButton
                color="neutral" variant="ghost" icon="i-lucide-arrow-down" class="min-h-10 min-w-10 justify-center" :aria-label="`${s.moveDown}: ${question.text}`"
                :disabled="busy || index === block.questions.length - 1" @click="reorder(moveQuestion(questions, question.id, 1))"
              />
            </template>
            <RowActions v-else :actions="actionsOf(question)" :name="question.text" size="xs" />
          </div>
        </li>
      </ul>
    </div>

    <form v-if="editing !== null" class="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2" @submit.prevent="save">
      <h3 class="font-medium sm:col-span-2">{{ editing === 'new' ? s.addTitle : s.editTitle }}</h3>
      <UFormField :label="s.text" class="sm:col-span-2">
        <UTextarea v-model="form.text" :rows="2" :maxlength="CONSENT_TEXT_MAX" class="w-full" />
      </UFormField>
      <UFormField :label="s.short"><UInput v-model="form.short" :maxlength="CONSENT_SHORT_MAX" class="w-full" /></UFormField>
      <UFormField :label="s.area">
        <USelect v-model="form.area" :items="areaItems" class="w-full" />
        <UInput
          v-if="form.area === NEW_AREA" v-model="form.newArea" class="mt-2 w-full" :maxlength="CONSENT_AREA_MAX"
          :placeholder="s.newAreaName" :aria-label="s.newAreaName"
        />
      </UFormField>
      <div class="flex gap-2 sm:col-span-2">
        <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
        <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="cancel" />
      </div>
    </form>
    <UButton v-else size="sm" variant="outline" icon="i-lucide-plus" :label="s.add" :disabled="busy" @click="startEdit(null)" />
  </section>
</template>
