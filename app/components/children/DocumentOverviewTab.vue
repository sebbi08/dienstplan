<script setup lang="ts">
import type { DocumentOverviewDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { documentFileUrl } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/** Completeness view: the active children against the important document types. */
const { data, error } = useFetch<DocumentOverviewDto>('/api/child-documents/overview', { key: 'child-documents-overview' })
const { groupName } = useChildLookups()
// No printouts at the tablet.
const { onTablet } = useChildRights()

const onlyMissing = ref(false)
const rows = computed(() => (data.value?.rows ?? []).filter(row => !onlyMissing.value || row.missingRequired))
const showGroups = computed(() => (data.value?.rows ?? []).some(row => row.groupId !== null))

const th = 'px-3 py-2'
const td = 'px-3 py-2'
</script>

<template>
  <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
  <div v-else-if="data" class="space-y-3">
    <p v-if="!data.types.length" class="text-sm text-gray-500">{{ de.childDocuments.noImportantTypes }}</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <UCheckbox v-model="onlyMissing" :label="de.childDocuments.onlyMissing" />
        <UButton v-if="!onTablet" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print" to="/print/children/documents" target="_blank" />
      </div>
      <p class="text-sm text-gray-500">{{ de.childDocuments.overviewHint }}</p>
      <p v-if="!rows.length" class="text-sm text-gray-500">{{ de.children.empty }}</p>
      <div v-else class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
        <table class="w-full bg-white text-sm">
          <thead class="bg-gray-100 text-left text-xs text-gray-600">
            <tr>
              <th :class="th">{{ de.children.fields.name }}</th>
              <th v-if="showGroups" :class="th">{{ de.children.fields.group }}</th>
              <th v-for="type in data.types" :key="type.id" :class="th">{{ type.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.childId" class="border-t border-gray-100">
              <td :class="td"><NuxtLink :to="`/children/${row.childId}`" class="font-medium text-sky-700 hover:underline">{{ row.name }}</NuxtLink></td>
              <td v-if="showGroups" :class="td">{{ groupName(row.groupId) }}</td>
              <td v-for="type in data.types" :key="type.id" :class="td">
                <span
                  v-if="row.cells[type.id]?.stale" class="whitespace-nowrap font-medium text-red-700"
                  :title="formatDate(row.cells[type.id]!.documentDate)"
                >{{ de.groupChange.resubmit }}</span>
                <template v-else-if="row.cells[type.id]">
                  <a
                    v-if="row.cells[type.id]!.canOpen" :href="documentFileUrl(row.cells[type.id]!.documentId)" target="_blank" rel="noopener"
                    class="whitespace-nowrap text-sky-700 hover:underline"
                  >✓ {{ formatDate(row.cells[type.id]!.documentDate) }}</a>
                  <span v-else class="inline-flex items-center gap-1 whitespace-nowrap text-gray-700">
                    ✓ {{ formatDate(row.cells[type.id]!.documentDate) }}
                    <UIcon name="i-lucide-lock" class="size-4 text-gray-500" role="img" :aria-label="de.childDocuments.lockedHint" :title="de.childDocuments.lockedHint" />
                  </span>
                </template>
                <span v-else-if="type.required" class="font-medium text-red-700">{{ de.childDocuments.missing }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
