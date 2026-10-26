<script setup lang="ts">
import type { FormAnswers } from '#shared/domain/forms'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'
import { filledAnswers, type FormPanelForm, type FormPanelSave } from '~/utils/forms'

/**
 * A form with its answers and an explicit „Speichern“ (with a hint while something is unsaved). Saving sends the
 * updatedAt the form was loaded with; when someone else saved in between (409 form_changed) it says so and offers
 * „Neu laden“, which discards the own edits (asked first). `refresh` reloads the form from the parent.
 *
 * Saving is a PUT of `{ answers, expectedUpdatedAt }` to `saveUrl`, or the `save` handler (e.g. one that sends header
 * fields along). Fields of the parent's own (slot `before`, above the answers) count as unsaved through `extraDirty`;
 * `check` may refuse a save with a message first; `reset` is emitted when the panel goes back to the stored form, so
 * the parent can reset its fields too. The slot `actions` gets `dirty`, `save` and `base` (the updatedAt the answers on
 * screen are based on, read after a save) (e.g. for „Abgeben“, which saves first). `dirty` is also emitted, so a
 * parent can ask before it closes the panel.
 */
const props = defineProps<{
  form: FormPanelForm
  saveUrl?: string
  save?: FormPanelSave
  editable: boolean
  refresh: () => Promise<unknown>
  extraDirty?: boolean
  check?: () => string | null
}>()
const emit = defineEmits<{ dirty: [value: boolean]; reset: [] }>()
const toast = useToast()
const confirm = useConfirm()

const answers = ref(filledAnswers(props.form.content, props.form.answers))
const savedJson = ref(JSON.stringify(answers.value))
const base = ref(props.form.updatedAt)
const conflict = ref(false)
const saving = ref(false)
const dirty = useDirty(() => props.editable && (JSON.stringify(answers.value) !== savedJson.value || !!props.extraDirty))
watch(dirty, value => emit('dirty', value), { immediate: true })

function reset() {
  answers.value = filledAnswers(props.form.content, props.form.answers)
  savedJson.value = JSON.stringify(answers.value)
  base.value = props.form.updatedAt
  conflict.value = false
  emit('reset')
}
// Someone else's save (seen on a reload) is taken over while nothing is typed here.
watch(() => props.form.updatedAt, () => {
  if (!dirty.value && !saving.value) reset()
})

const putAnswers: FormPanelSave = (sent, expectedUpdatedAt) =>
  $fetch<{ updatedAt: string }>(props.saveUrl!, { method: 'PUT', body: { answers: sent, expectedUpdatedAt } })

/** Saves the answers; true on success. */
async function save(): Promise<boolean> {
  if (!dirty.value) return true
  const refused = props.check?.()
  if (refused) {
    toast.add({ title: refused, color: 'error' })
    return false
  }
  saving.value = true
  const sent = JSON.stringify(answers.value)
  try {
    const saved = await (props.save ?? putAnswers)(JSON.parse(sent) as FormAnswers, base.value)
    savedJson.value = sent
    // The next save is checked against the time of this very save (not against a reload that may lag behind).
    base.value = saved.updatedAt
    await props.refresh()
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
  if (dirty.value && !await confirm(de.forms.reloadConfirm, { confirmLabel: de.forms.reload })) return
  await props.refresh()
  reset()
}
</script>

<template>
  <div class="space-y-3">
    <UAlert v-if="conflict" color="warning" variant="soft" :title="de.errors.form_changed" :description="de.forms.reloadHint">
      <template #actions>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="de.forms.reload" @click="reload" />
      </template>
    </UAlert>
    <slot name="before" />
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
      <slot name="actions" :dirty="dirty" :save="save" :base="() => base" />
    </div>
  </div>
</template>
