<script setup lang="ts">
import type { KnowledgeConfirmationsDto, KnowledgeEntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { knowledgePrintPath, peopleByState } from '~/utils/knowledge'
import { berlinDay } from '~/utils/printTemplates'

/**
 * „Wer hat bestätigt?“ (knowledge.manage): who of the facility's staff confirmed the entry (with the date), who only an
 * earlier version and who not yet, with the printable proof („Nachweis drucken“).
 */
const props = defineProps<{ entry: KnowledgeEntryDto | null }>()
const open = defineModel<boolean>('open', { required: true })

const t = de.knowledge.overview
const data = ref<KnowledgeConfirmationsDto | null>(null)
const loadError = ref('')
const loading = ref(false)

watch(open, async (isOpen) => {
  if (!isOpen || !props.entry) return
  data.value = null
  loadError.value = ''
  loading.value = true
  try {
    data.value = await $fetch<KnowledgeConfirmationsDto>(`/api/knowledge/${props.entry.id}/confirmations`)
  }
  catch (error) {
    loadError.value = errorMessage(error)
  }
  finally {
    loading.value = false
  }
})

const groups = computed(() => {
  const byState = peopleByState(data.value?.people ?? [])
  return [
    { key: 'open', label: t.open, people: byState.open, tone: 'text-red-800' },
    { key: 'outdated', label: t.outdated, people: byState.outdated, tone: 'text-amber-800' },
    { key: 'confirmed', label: t.confirmed, people: byState.confirmed, tone: 'text-green-800' },
  ]
})
const day = (timestamp: string | null) => (timestamp ? formatDate(berlinDay(timestamp)) : '')
</script>

<template>
  <UModal v-model:open="open" :title="entry ? t.title(entry.title) : ''">
    <template #body>
      <div class="space-y-4 text-sm">
        <p class="text-gray-600">{{ t.intro }}</p>
        <UAlert v-if="loadError" color="warning" variant="soft" :title="loadError" />
        <p v-else-if="loading" class="text-gray-500">{{ t.loading }}</p>
        <template v-else-if="data">
          <UAlert v-if="!data.entry.needsConfirmation" color="neutral" variant="soft" :title="t.notRequired" />
          <section v-for="group in groups" :key="group.key" class="space-y-1">
            <h3 class="font-semibold" :class="group.tone">{{ group.label }} ({{ group.people.length }})</h3>
            <p v-if="!group.people.length" class="text-gray-500">{{ t.none }}</p>
            <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
              <li v-for="person in group.people" :key="person.employeeId" class="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                <span class="font-medium">{{ person.name }}</span>
                <span v-if="person.confirmedAt" class="text-gray-600">{{ day(person.confirmedAt) }}<template v-if="person.via"> · {{ t.via[person.via] }}</template></span>
                <span v-if="!person.expected" class="text-xs text-gray-500">({{ t.notExpected }})</span>
              </li>
            </ul>
          </section>
          <UButton
            v-if="entry" :to="knowledgePrintPath(entry.id)" target="_blank" color="neutral" variant="outline" icon="i-lucide-printer"
            :label="t.print"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
