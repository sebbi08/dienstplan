<script setup lang="ts">
import { compareForms, type CompareSection } from '#shared/domain/formHistory'
import { formatTime } from '#shared/domain/time'
import type { ChildFormDto, ChildFormListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { comparableGroups, olderAndNewer } from '~/utils/forms'

/**
 * „Vergleichen“: two forms of the same template side by side (by default the two newest), laid out by the newer form,
 * ratings and milestones with trend arrows. Both forms are read through the form route, so only forms the viewer may
 * open can be compared. In the office the comparison prints (A4); the tablet never prints child data.
 */
const props = defineProps<{ forms: ChildFormListItemDto[]; onTablet: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const h = de.formHistory

const groups = computed(() => comparableGroups(props.forms))
const templateId = ref<number | undefined>(undefined)
const firstId = ref<number | undefined>(undefined)
const secondId = ref<number | undefined>(undefined)
const group = computed(() => groups.value.find(entry => entry.templateId === templateId.value))
const loading = ref(false)
const loadError = ref<unknown>(null)
const result = ref<{ older: ChildFormDto; newer: ChildFormDto; sections: CompareSection[] } | null>(null)

const formLabel = (form: ChildFormListItemDto) => {
  const day = form.date ? formatDate(form.date) : ''
  return form.start === null ? day : `${day} ${de.childForms.atTime(formatTime(form.start))}`
}
const formItems = computed(() => (group.value?.forms ?? []).map(form => ({ label: formLabel(form), value: form.id })))
const templateItems = computed(() => groups.value.map(entry => ({ label: entry.title, value: entry.templateId })))

/** The template's two newest forms: the older one first. */
function pickNewest() {
  const forms = group.value?.forms ?? []
  secondId.value = forms[0]?.id
  firstId.value = forms[1]?.id
  result.value = null
}
watch(open, (value) => {
  if (!value) return
  templateId.value = groups.value[0]?.templateId
  pickNewest()
  loadError.value = null
}, { immediate: true })
watch(templateId, pickNewest)

const pair = computed(() => (firstId.value !== undefined && secondId.value !== undefined
  ? olderAndNewer(props.forms, firstId.value, secondId.value)
  : null))

async function show() {
  const picked = pair.value
  if (!picked) return
  loading.value = true
  loadError.value = null
  try {
    const [older, newer] = await Promise.all([
      $fetch<ChildFormDto>(`/api/child-forms/${picked.older.id}`), $fetch<ChildFormDto>(`/api/child-forms/${picked.newer.id}`),
    ])
    result.value = { older, newer, sections: compareForms(newer, older) }
  }
  catch (error) {
    loadError.value = error
  }
  finally {
    loading.value = false
  }
}
const dayLabel = (form: ChildFormDto) => h.formLabel(form.date ? formatDate(form.date) : '')
</script>

<template>
  <UModal v-model:open="open" :title="h.compareTitle" :description="h.compareHint" :ui="{ content: 'sm:max-w-5xl' }">
    <template #body>
      <div class="space-y-3">
        <form class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" @submit.prevent="show">
          <UFormField :label="h.compareTemplate">
            <USelect v-model="templateId" :items="templateItems" size="lg" class="w-full" :disabled="templateItems.length < 2" />
          </UFormField>
          <UFormField :label="h.compareOlder">
            <USelect v-model="firstId" :items="formItems" size="lg" class="w-full" @update:model-value="result = null" />
          </UFormField>
          <UFormField :label="h.compareNewer">
            <USelect v-model="secondId" :items="formItems" size="lg" class="w-full" @update:model-value="result = null" />
          </UFormField>
          <UButton type="submit" class="min-h-11 justify-center" icon="i-lucide-columns-2" :label="h.compareShow" :loading="loading" :disabled="!pair" />
        </form>
        <p v-if="!pair" class="text-sm text-amber-800">{{ h.compareSame }}</p>
        <p v-if="loadError" class="text-sm text-red-700" role="alert">{{ errorMessage(loadError) }}</p>
        <template v-if="result">
          <div v-if="!props.onTablet" class="flex justify-end">
            <UButton
              class="min-h-11" color="neutral" variant="outline" icon="i-lucide-printer" :label="h.print" target="_blank"
              :to="`/print/children/forms/compare/${result.older.id}/${result.newer.id}`"
            />
          </div>
          <FormsFormCompare :sections="result.sections" :older-label="dayLabel(result.older)" :newer-label="dayLabel(result.newer)" />
        </template>
      </div>
    </template>
  </UModal>
</template>
