<script setup lang="ts">
import { groupByArea } from '#shared/domain/childConsents'
import type { ChildRecordDto, ConsentAnswerInput, TriState } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Consents and permissions (Einwilligungen & Erlaubnisse) of the parents: the facility's own questions grouped by area,
 * each ja / nein / offen; the open ones are grey. A question the facility hid shows only where this child has an
 * answer, read-only under „ausgeblendete Fragen“ (the answer stays as proof).
 */
/** `reload` re-reads the record; the busy flag stays on until it is done, so the next action works on fresh data. */
const props = defineProps<{ child: ChildRecordDto; reload: () => Promise<unknown> }>()
const { busy, run } = useBusyAction(() => props.reload())

const visible = computed(() => props.child.consentQuestions.filter(question => !question.hidden))
const hidden = computed(() => props.child.consentQuestions.filter(question => question.hidden))
const blocks = computed(() => groupByArea(visible.value))
const answerOf = (id: number): TriState => props.child.consents[id] ?? null

const editing = ref(false)
const form = reactive<Record<number, TriState>>({})
function reset() {
  for (const key of Object.keys(form)) delete form[Number(key)]
  for (const question of visible.value) form[question.id] = answerOf(question.id)
}
reset()
// Another section's save refreshes the record; do not wipe what is being typed here.
watch(() => props.child.consents, () => { if (!editing.value) reset() })
watch(editing, (value) => { if (value) reset() })

async function save() {
  const answers: ConsentAnswerInput[] = visible.value.map(question => ({ questionId: question.id, value: form[question.id] ?? null }))
  const ok = await run(() => $fetch<unknown>(`/api/children/${props.child.id}/consents`, { method: 'PUT', body: { answers } }), de.common.saved)
  if (ok) editing.value = false
}
function cancel() {
  reset()
  editing.value = false
}
</script>

<template>
  <ChildrenChildSection v-model:editing="editing" :title="de.children.sections.consents" :stamp="child.stamps.consents" :can-edit="child.canEdit">
    <template #banner><ChildrenReviewBanner :child="child" section="consents" :reload="reload" /></template>

    <p v-if="!child.consentQuestions.length" class="text-sm text-gray-500">{{ de.children.noConsentQuestions }}</p>
    <div class="grid gap-4 md:grid-cols-2">
      <div v-for="block in blocks" :key="block.area" class="space-y-1">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.area }}</h3>
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="question in block.questions" :key="question.id" class="flex items-center justify-between gap-3 py-1.5">
            <span>{{ question.text }}</span>
            <ChildrenTriStateSelect :model-value="answerOf(question.id)" readonly />
          </li>
        </ul>
      </div>
    </div>

    <template #edit>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-4 md:grid-cols-2">
          <div v-for="block in blocks" :key="block.area" class="space-y-1">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.area }}</h3>
            <ul class="divide-y divide-gray-100 text-sm">
              <li v-for="question in block.questions" :key="question.id" class="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{{ question.text }}</span>
                <ChildrenTriStateSelect v-model="form[question.id]!" :label="question.text" />
              </li>
            </ul>
          </div>
        </div>
        <div class="flex gap-2">
          <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="cancel" />
        </div>
      </form>
    </template>

    <!-- Read-only (not part of the edit form): a hidden question is no longer asked, its answer stays as proof. -->
    <div v-if="hidden.length" class="space-y-1 border-t border-gray-100 pt-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ de.children.consentsHidden }}</h3>
      <p class="text-xs text-gray-500">{{ de.children.consentsHiddenHint }}</p>
      <ul class="divide-y divide-gray-100 text-sm">
        <li v-for="question in hidden" :key="question.id" class="flex items-center justify-between gap-3 py-1.5 text-gray-600">
          <span>{{ question.text }} <span class="text-xs text-gray-400">({{ question.area }})</span></span>
          <ChildrenTriStateSelect :model-value="answerOf(question.id)" readonly />
        </li>
      </ul>
    </div>
  </ChildrenChildSection>
</template>
