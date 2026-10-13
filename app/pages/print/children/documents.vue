<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { DocumentOverviewDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })

const { data, error } = await useFetch<DocumentOverviewDto>('/api/child-documents/overview', { key: 'print-children-documents' })
const lookups = useChildLookups()
await lookups.ready
const { groupName } = lookups
const showGroups = computed(() => (data.value?.rows ?? []).some(row => row.groupId !== null))

const th = 'px-2 py-1.5'
const td = 'px-2 py-1.5'
</script>

<template>
  <div class="mx-auto max-w-5xl bg-white p-6 text-gray-900">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.children.printDocuments }}</h1>
      <PrintActions file-name="Dokumentenuebersicht-Kinder" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!data?.rows.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-gray-400 text-left text-xs text-gray-600">
        <tr>
          <th :class="th">{{ de.children.fields.name }}</th>
          <th v-if="showGroups" :class="th">{{ de.children.fields.group }}</th>
          <th v-for="type in data.types" :key="type.id" :class="th">{{ type.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data.rows" :key="row.childId" class="break-inside-avoid border-b border-gray-200">
          <td :class="td" class="font-medium">{{ row.name }}</td>
          <td v-if="showGroups" :class="td">{{ groupName(row.groupId) }}</td>
          <td v-for="type in data.types" :key="type.id" :class="td" class="whitespace-nowrap">
            <span v-if="row.cells[type.id]?.stale" class="font-medium text-red-700">{{ de.groupChange.resubmit }}</span>
            <template v-else-if="row.cells[type.id]">✓ {{ formatDate(row.cells[type.id]!.documentDate) }}</template>
            <span v-else-if="type.required" class="font-medium text-red-700">{{ de.childDocuments.missing }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
