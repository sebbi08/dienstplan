<script setup lang="ts">
import { formDiff } from '#shared/domain/formHistory'
import type { FormAnswer, FormAnswers, FormContent } from '#shared/domain/forms'
import type { FormRevisionDto, FormRevisionListItemDto, FormRevisionsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'
import { filledAnswers } from '~/utils/forms'

/**
 * „Verlauf“ of a form (child forms, staff talk forms): every save that changed answers, newest first and paged (date and
 * time, person, number of changed items). A tap opens that state read-only („Stand vom …“); „Änderungen zeigen“ marks
 * per item how it differs from the current answers (`answers`, as stored now). `url` is the form's API address (its
 * `/revisions` answer the list and each state; they check who may see it). `initialLabel` names the revision the history
 * starts with (default „Stand vor Beginn des Verlaufs“; a copied staff talk form: „übernommen aus dem Gespräch vom …“).
 */
const props = defineProps<{ url: string; title: string; content: FormContent; answers: FormAnswers; initialLabel?: string }>()
const open = defineModel<boolean>('open', { required: true })
const h = de.formHistory

const revisions = ref<FormRevisionListItemDto[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref<unknown>(null)
const selected = ref<FormRevisionDto | null>(null)
const selectedAnswers = ref<Record<string, FormAnswer>>({})
const showDiff = ref(false)

async function loadPage(offset: number) {
  loading.value = true
  loadError.value = null
  try {
    const page = await $fetch<FormRevisionsDto>(`${props.url}/revisions`, { query: { offset } })
    // A save in between shifts the pages by one: an entry seen already is not listed twice.
    const known = new Set(offset === 0 ? [] : revisions.value.map(revision => revision.id))
    revisions.value = [...(offset === 0 ? [] : revisions.value), ...page.revisions.filter(revision => !known.has(revision.id))]
    total.value = page.total
  }
  catch (error) {
    loadError.value = error
  }
  finally {
    loading.value = false
  }
}

// Every opening starts at the newest page and the list.
watch(open, (value) => {
  if (!value) return
  selected.value = null
  showDiff.value = false
  revisions.value = []
  void loadPage(0)
}, { immediate: true })

async function select(revision: FormRevisionListItemDto) {
  loading.value = true
  loadError.value = null
  try {
    const loaded = await $fetch<FormRevisionDto>(`${props.url}/revisions/${revision.id}`)
    selectedAnswers.value = filledAnswers(props.content, loaded.answers)
    selected.value = loaded
    showDiff.value = false
  }
  catch (error) {
    loadError.value = error
  }
  finally {
    loading.value = false
  }
}

const diff = computed(() => (selected.value ? formDiff(props.content, selected.value.answers, props.answers) : {}))
const diffCount = computed(() => Object.keys(diff.value).length)
const changedLabel = (revision: FormRevisionListItemDto) => (revision.initial ? props.initialLabel ?? h.initial : h.changedCount(revision.changedCount))
</script>

<template>
  <UModal v-model:open="open" :title="h.historyTitle(props.title)" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <div class="space-y-3">
        <p v-if="loadError" class="text-sm text-red-700" role="alert">{{ errorMessage(loadError) }}</p>

        <template v-if="selected">
          <div class="flex flex-wrap items-center gap-2">
            <UButton class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="h.back" @click="selected = null" />
            <UButton
              class="min-h-11" color="neutral" variant="outline" :icon="showDiff ? 'i-lucide-eye-off' : 'i-lucide-git-compare'"
              :label="showDiff ? h.hideChanges : h.showChanges" :aria-pressed="showDiff" @click="showDiff = !showDiff"
            />
          </div>
          <div class="space-y-0.5">
            <p class="font-semibold">{{ h.standOf(formatDateTime(selected.savedAt)) }}</p>
            <p class="text-sm text-gray-600">
              {{ selected.savedBy ? h.standBy(selected.savedBy) : '' }}{{ selected.savedBy ? ' · ' : '' }}{{ changedLabel(selected) }}
            </p>
            <p v-if="showDiff" class="text-sm text-gray-700" role="status">
              {{ h.changesHint }} {{ diffCount ? h.changesCount(diffCount) : h.noChanges }}
            </p>
          </div>
          <FormsFormFiller v-model:answers="selectedAnswers" :content="props.content" readonly :diff="showDiff ? diff : undefined" />
        </template>

        <template v-else>
          <p class="text-sm text-gray-600">{{ h.historyHint }}</p>
          <p v-if="!loading && !loadError && !revisions.length" class="text-sm text-gray-600">{{ h.historyNone }}</p>
          <ul v-if="revisions.length" class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
            <li v-for="revision in revisions" :key="revision.id">
              <button
                type="button" class="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-gray-50"
                @click="select(revision)"
              >
                <span class="text-sm font-medium">{{ h.savedLine(formatDateTime(revision.savedAt), revision.savedBy) }}</span>
                <span class="text-xs text-gray-600">{{ changedLabel(revision) }}</span>
              </button>
            </li>
          </ul>
          <UButton
            v-if="revisions.length < total" class="min-h-11" color="neutral" variant="outline" icon="i-lucide-chevrons-down"
            :label="h.more" :loading="loading" @click="loadPage(revisions.length)"
          />
        </template>
        <p v-if="loading && !revisions.length && !selected" class="text-sm text-gray-500">{{ h.loading }}</p>
      </div>
    </template>
  </UModal>
</template>
