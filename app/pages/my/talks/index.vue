<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { MyTalkDto, TalkFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'

/**
 * „Meine Gespräche“: the signed-in employee's talks with the forms released to them – self-assessments to fill in
 * (or already submitted) and assessments to read. A list, not a table: most read this on their phone.
 */
const { data, error } = await useFetch<MyTalkDto[]>('/api/my/talks')

const talkTitle = (talk: MyTalkDto) =>
  talk.start === null ? de.talks.talkOn(formatDate(talk.date)) : `${de.talks.talkOn(formatDate(talk.date))} ${de.talks.atTime(formatTime(talk.start))}`
function stateText(form: TalkFormDto): string {
  if (form.role === 'assessment') return de.talks.toRead
  if (form.state === 'submitted' && form.submittedAt) return de.talks.submittedAt(formatDateTime(form.submittedAt))
  return de.talks.toFill
}
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.nav.myTalks }}</h1>
    <p class="text-sm text-gray-500">{{ de.talks.myIntro }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="data && !data.length" class="text-sm text-gray-500">{{ de.talks.myNone }}</p>
    <section v-for="talk in data ?? []" :key="talk.id" class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ talkTitle(talk) }}</h2>
      <p v-if="talk.period" class="text-sm break-words text-gray-600">{{ de.talks.period }}: {{ talk.period }}</p>
      <ul class="mt-2 divide-y divide-gray-100">
        <li v-for="form in talk.forms" :key="form.id" class="flex flex-wrap items-center gap-2 py-2">
          <div class="min-w-0 flex-1 basis-48">
            <NuxtLink :to="`/my/talks/${form.id}`" class="font-medium break-words text-sky-700 underline-offset-2 hover:underline">{{ form.title }}</NuxtLink>
            <p class="text-xs text-gray-500">{{ stateText(form) }}</p>
          </div>
          <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-printer" :aria-label="`${de.talks.print}: ${form.title}`" :to="`/print/my-forms/${form.id}`" target="_blank" />
        </li>
      </ul>
    </section>
  </div>
</template>
