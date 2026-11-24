<script setup lang="ts">
import { compareForms, type CompareSection } from '#shared/domain/formHistory'
import type { MyTalkFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { compareLabels } from '~/utils/forms'

/**
 * „Mit dem vorigen Gespräch vergleichen“: a copied talk form (`formId`) side by side with the form it was copied from
 * (`sourceFormId`), the earlier one left, laid out by the new form, ratings and milestones with trend arrows. Both are
 * read through the talk form route (Leitung and Träger of the facility); printable.
 */
const props = defineProps<{ formId: number; sourceFormId: number; title: string }>()
const open = defineModel<boolean>('open', { required: true })
const h = de.formHistory

const loading = ref(false)
const loadError = ref<unknown>(null)
const result = ref<{ older: MyTalkFormDto; newer: MyTalkFormDto; sections: CompareSection[] } | null>(null)
const labels = computed(() => (result.value ? compareLabels(result.value.older.talk, result.value.newer.talk, h.talkLabel) : { older: '', newer: '' }))

watch(open, async (value) => {
  if (!value) return
  loading.value = true
  loadError.value = null
  result.value = null
  try {
    const [older, newer] = await Promise.all([
      $fetch<MyTalkFormDto>(`/api/staff-talks/forms/${props.sourceFormId}`), $fetch<MyTalkFormDto>(`/api/staff-talks/forms/${props.formId}`),
    ])
    result.value = { older, newer, sections: compareForms(newer.form, older.form) }
  }
  catch (error) {
    loadError.value = error
  }
  finally {
    loading.value = false
  }
}, { immediate: true })
</script>

<template>
  <UModal v-model:open="open" :title="h.comparePreviousTitle(props.title)" :ui="{ content: 'sm:max-w-5xl' }">
    <template #body>
      <div class="space-y-3">
        <p class="text-sm text-gray-600">{{ h.comparePreviousHint }}</p>
        <p v-if="loading" class="text-sm text-gray-500">{{ h.loading }}</p>
        <p v-if="loadError" class="text-sm text-red-700" role="alert">{{ errorMessage(loadError) }}</p>
        <template v-if="result">
          <div class="flex justify-end">
            <UButton
              class="min-h-11" color="neutral" variant="outline" icon="i-lucide-printer" :label="h.print" target="_blank"
              :to="`/admin/print/forms/compare/${props.sourceFormId}/${props.formId}`"
            />
          </div>
          <FormsFormCompare :sections="result.sections" :older-label="labels.older" :newer-label="labels.newer" />
        </template>
      </div>
    </template>
  </UModal>
</template>
