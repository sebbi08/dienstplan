<script setup lang="ts">
import type { TalkFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'
import { filledAnswers } from '~/utils/forms'

/**
 * A form with its answers and an explicit „Speichern“ (with a hint while something is unsaved). Saving sends the
 * updatedAt the form was loaded with; when someone else saved in between (409 form_changed) it says so and offers
 * „Neu laden“, which discards the own edits. `refresh` reloads the form from the parent. The slot `actions` gets
 * `dirty` and `save` (e.g. for „Abgeben“, which saves first).
 */
const props = defineProps<{ form: TalkFormDto; saveUrl: string; editable: boolean; refresh: () => Promise<unknown> }>()
const toast = useToast()

const answers = ref(filledAnswers(props.form.content, props.form.answers))
const savedJson = ref(JSON.stringify(answers.value))
const base = ref(props.form.updatedAt)
const conflict = ref(false)
const saving = ref(false)
const dirty = useDirty(() => props.editable && JSON.stringify(answers.value) !== savedJson.value)

function reset() {
  answers.value = filledAnswers(props.form.content, props.form.answers)
  savedJson.value = JSON.stringify(answers.value)
  base.value = props.form.updatedAt
  conflict.value = false
}
// Someone else's save (seen on a reload) is taken over while nothing is typed here.
watch(() => props.form.updatedAt, () => {
  if (!dirty.value && !saving.value) reset()
})

/** Saves the answers; true on success. */
async function save(): Promise<boolean> {
  if (!dirty.value) return true
  saving.value = true
  const sent = JSON.stringify(answers.value)
  try {
    await $fetch<unknown>(props.saveUrl, { method: 'PUT', body: { answers: JSON.parse(sent), expectedUpdatedAt: base.value } })
    savedJson.value = sent
    await props.refresh()
    // The reload carries the time of this very save: the next save is checked against it.
    base.value = props.form.updatedAt
    toast.add({ title: de.common.saved, color: 'success' })
    return true
  }
  catch (error) {
    if (errorCode(error) === 'form_changed') conflict.value = true
    else toast.add({ title: errorMessage(error), color: 'error' })
    return false
  }
  finally {
    saving.value = false
  }
}

async function reload() {
  await props.refresh()
  reset()
}
</script>

<template>
  <div class="space-y-3">
    <UAlert v-if="conflict" color="warning" variant="soft" :title="de.errors.form_changed">
      <template #actions>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="de.forms.reload" @click="reload" />
      </template>
    </UAlert>
    <FormsFormFiller v-model:answers="answers" :content="props.form.content" :readonly="!props.editable" />
    <p class="text-xs text-gray-500">{{ de.forms.lastChanged(props.form.updatedBy, formatDateTime(props.form.updatedAt)) }}</p>
    <div
      v-if="props.editable || $slots.actions"
      class="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white/95 px-1 py-2 print:hidden"
    >
      <UButton
        v-if="props.editable" icon="i-lucide-save" :label="de.common.save" :loading="saving" :disabled="!dirty || conflict"
        @click="save"
      />
      <span v-if="dirty" class="text-sm text-amber-700">{{ de.forms.unsaved }}</span>
      <slot name="actions" :dirty="dirty" :save="save" />
    </div>
  </div>
</template>
