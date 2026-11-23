<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { KnowledgeConfirmationsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { berlinDay } from '~/utils/printTemplates'

/**
 * The printed proof („Nachweis“) of who of the facility confirmed an entry of „Wissen“ as read and understood, who only
 * an earlier version and who not yet (knowledge.manage; the server decides, as in the dialog).
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 12px !important; } }' }] })

const t = de.knowledge.print
const route = useRoute()
const id = computed(() => Number(route.params.id))
const { data, error } = await useFetch<KnowledgeConfirmationsDto>(() => `/api/knowledge/${id.value}/confirmations`, { key: `print-knowledge-${id.value}` })
const day = (timestamp: string | null) => (timestamp ? formatDate(berlinDay(timestamp)) : '')
const fileName = computed(() => t.fileName(data.value?.entry.title ?? ''))

const th = 'px-2 py-1.5 align-bottom'
const td = 'px-2 py-1.5 align-top'
</script>

<template>
  <div class="mx-auto max-w-4xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ t.title }}</h1>
      <PrintActions :file-name="fileName" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <dl class="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-gray-600 print:text-gray-900">{{ t.entry }}</dt>
        <dd class="font-medium">{{ data.entry.title }}</dd>
        <dt class="text-gray-600 print:text-gray-900">{{ t.category }}</dt>
        <dd>{{ data.entry.category }}</dd>
        <dt class="text-gray-600 print:text-gray-900">{{ t.facility }}</dt>
        <dd>{{ data.facilityName }}</dd>
        <dt />
        <dd>
          {{ t.version(data.entry.version, day(data.entry.updatedAt)) }}<template v-if="data.entry.asOf"> · {{ de.knowledge.asOf(formatDate(data.entry.asOf)) }}</template>
        </dd>
      </dl>
      <table class="w-full text-sm">
        <thead class="border-b border-gray-400 text-left text-xs text-gray-600 print:text-gray-900">
          <tr>
            <th :class="th">{{ t.name }}</th>
            <th :class="th">{{ t.state }}</th>
            <th :class="th">{{ t.confirmedAt }}</th>
            <th :class="th">{{ t.via }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="person in data.people" :key="person.employeeId" class="break-inside-avoid border-b border-gray-200">
            <td :class="td">
              {{ person.name }}
              <span v-if="!person.expected" class="block text-xs text-gray-600 print:text-gray-900">{{ de.knowledge.overview.notExpected }}</span>
            </td>
            <td :class="td">{{ t.states[person.state] }}</td>
            <td :class="td">{{ day(person.confirmedAt) }}</td>
            <td :class="td">{{ person.via ? de.knowledge.overview.via[person.via] : '' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
