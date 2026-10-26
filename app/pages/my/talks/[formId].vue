<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { MyTalkFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'

/**
 * One form of the own talk. A released self-assessment is filled in here: „Speichern“ keeps a draft, „Abgeben“ (asks
 * first) hands it in, after which it is read-only. Assessments released to read and submitted forms are only shown.
 */
const route = useRoute()
const formId = Number(route.params.formId)
const { data, error, refresh } = await useFetch<MyTalkFormDto>(`/api/my/talks/forms/${formId}`)
const toast = useToast()
const confirm = useConfirm()
useUnsavedGuard()

const editable = computed(() => data.value?.form.role === 'self' && data.value.form.state === 'released')
const talkLine = computed(() => {
  const talk = data.value?.talk
  if (!talk) return ''
  const day = de.talks.talkOn(formatDate(talk.date))
  return talk.start === null ? day : `${day} ${de.talks.atTime(formatTime(talk.start))}`
})

/**
 * Saves unsaved answers first, then asks and submits what is on screen (its updatedAt). When the Leitung saved in
 * between (409 form_changed), the form is reloaded so the employee sees those answers before submitting.
 */
async function submit(dirty: boolean, save: () => Promise<boolean>, base: () => string) {
  if (!await confirm(de.talks.submitConfirm, { confirmLabel: de.talks.submit, danger: false })) return
  if (dirty && !await save()) return
  try {
    await $fetch<unknown>(`/api/my/talks/forms/${formId}/submit`, { method: 'POST', body: { expectedUpdatedAt: base() } })
    await refresh()
    toast.add({ title: de.talks.submitted, color: 'success' })
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
    if (errorCode(failure) === 'form_changed') await refresh()
  }
}
</script>

<template>
  <div class="max-w-3xl min-w-0 space-y-4">
    <UButton to="/my/talks" size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="de.talks.back" />
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <template v-if="data">
      <div class="flex flex-wrap items-start gap-2">
        <div class="min-w-0 flex-1 basis-56">
          <h1 class="text-2xl font-semibold break-words">{{ data.form.title }}</h1>
          <p class="text-sm text-gray-600">{{ talkLine }}</p>
          <p v-if="data.talk.period" class="text-sm break-words text-gray-600">{{ de.talks.period }}: {{ data.talk.period }}</p>
        </div>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.talks.print" :to="`/print/my-forms/${formId}`" target="_blank" />
      </div>
      <p v-if="editable" class="text-sm text-gray-600">{{ de.talks.myEditHint }}</p>
      <UAlert
        v-else-if="data.form.role === 'self'" color="neutral" variant="soft" icon="i-lucide-lock"
        :title="de.talks.mySubmitted" :description="data.form.submittedAt ? de.talks.submittedAt(formatDateTime(data.form.submittedAt)) : undefined"
      />
      <p v-else class="text-sm text-gray-600">{{ de.talks.myReadOnly }}</p>
      <FormsFormPanel :key="data.form.id" :form="data.form" :save-url="`/api/my/talks/forms/${formId}`" :editable="editable" :refresh="refresh">
        <template v-if="editable" #actions="{ dirty, save, base }">
          <UButton class="ml-auto" color="success" icon="i-lucide-check" :label="de.talks.submit" @click="submit(dirty, save, base)" />
        </template>
      </FormsFormPanel>
    </template>
  </div>
</template>
