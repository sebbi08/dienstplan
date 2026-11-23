<script setup lang="ts">
import { CONSENT_AREA_MAX, CONSENT_SHORT_MAX, CONSENT_TEXT_MAX, consentAreas, groupByArea } from '#shared/domain/childConsents'
import type { ConsentQuestionInput, ConsentQuestionSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { moveArea, moveQuestion } from '~/utils/consentSettings'

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

function reorder(ids: number[] | null) {
  if (ids) run(() => $fetch<unknown>('/api/child-consent-questions/order', { method: 'POST', body: { ids } }), de.common.saved)
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <p class="text-xs text-gray-500">{{ s.intro }} {{ s.hiddenHint }}</p>
    <p v-if="!questions.length" class="text-sm text-gray-500">{{ s.empty }}</p>

    <div v-for="(block, blockIndex) in blocks" :key="block.area" class="space-y-1">
      <div class="flex items-center gap-1">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.area }}</h3>
        <UButton
          size="xs" color="neutral" variant="ghost" icon="i-lucide-chevron-up" :aria-label="`${s.areaUp}: ${block.area}`"
          :disabled="busy || blockIndex === 0" @click="reorder(moveArea(questions, block.area, -1))"
        />
        <UButton
          size="xs" color="neutral" variant="ghost" icon="i-lucide-chevron-down" :aria-label="`${s.areaDown}: ${block.area}`"
          :disabled="busy || blockIndex === blocks.length - 1" @click="reorder(moveArea(questions, block.area, 1))"
        />
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
            <UButton
              size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`${s.moveUp}: ${question.text}`"
              :disabled="busy || index === 0" @click="reorder(moveQuestion(questions, question.id, -1))"
            />
            <UButton
              size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`${s.moveDown}: ${question.text}`"
              :disabled="busy || index === block.questions.length - 1" @click="reorder(moveQuestion(questions, question.id, 1))"
            />
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" :label="de.common.edit" :disabled="busy" @click="startEdit(question)" />
            <UButton
              size="xs" color="neutral" variant="outline" :icon="question.hidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
              :label="question.hidden ? s.show : s.hide" :disabled="busy" @click="setHidden(question, !question.hidden)"
            />
            <UButton
              v-if="!question.answerCount" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2"
              :aria-label="`${de.common.delete}: ${question.text}`" :disabled="busy" @click="remove(question)"
            />
            <UTooltip v-else :text="s.hideInsteadHint">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="s.hideInsteadHint" disabled />
            </UTooltip>
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
