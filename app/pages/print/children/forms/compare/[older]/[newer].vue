<script setup lang="ts">
import { compareForms } from '#shared/domain/formHistory'
import type { ChildFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { compareLabels } from '~/utils/forms'

/**
 * The printout of „Vergleichen“ (A4 portrait): two observation forms of a child side by side, the older left, ratings and
 * milestones with trend arrows. Like the other child printouts only for Leitung and Träger (the middleware keeps
 * Mitarbeiter accounts and the tablet away; the form route answers 404 to whoever may not see a form). Forms of two
 * different children are refused (the address can be edited by hand; the header would name only one child).
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })
const h = de.formHistory

const route = useRoute()
const olderId = Number(route.params.older)
const newerId = Number(route.params.newer)
const [{ data: older, error: olderError }, { data: newer, error: newerError }] = await Promise.all([
  useFetch<ChildFormDto>(`/api/child-forms/${olderId}`), useFetch<ChildFormDto>(`/api/child-forms/${newerId}`),
])
const otherChild = computed(() => !!older.value && !!newer.value && older.value.childId !== newer.value.childId)
const error = computed(() => olderError.value ?? newerError.value)
const sections = computed(() => (older.value && newer.value ? compareForms(newer.value, older.value) : []))
const labels = computed(() => (older.value && newer.value ? compareLabels(older.value, newer.value) : { older: '', newer: '' }))
const title = computed(() => (newer.value ? h.printTitle(newer.value.title) : ''))
useHead({ title })
const childName = computed(() => (newer.value ? `${newer.value.child.firstName} ${newer.value.child.lastName}`.trim() : ''))
const cell = 'border border-gray-500 px-1.5 py-1 align-top'
</script>

<template>
  <div class="mx-auto max-w-4xl bg-white p-6 text-sm text-gray-900 print:max-w-none print:p-0 print:text-[11px]">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-bold print:text-[18px]">{{ title }}</h1>
      <!-- No child's name in the file name: it travels in the PDF request's query (logs), like the other child printouts. -->
      <PrintActions v-if="older && newer && !otherChild" :file-name="`Vergleich-${olderId}-${newerId}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="otherChild" class="text-red-700" role="alert">{{ h.compareOtherChild }}</p>
    <template v-else-if="older && newer">
      <table class="mb-4 w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <th :class="[cell, 'w-[16%] bg-gray-100 text-left font-semibold']">{{ de.childForms.header.name }}</th>
            <td :class="[cell, 'w-[34%] break-words']">{{ childName }}</td>
            <th :class="[cell, 'w-[16%] bg-gray-100 text-left font-semibold']">{{ de.childForms.header.birthDate }}</th>
            <td :class="[cell, 'w-[34%]']">{{ formatDate(newer.child.birthDate) }}</td>
          </tr>
          <tr>
            <th :class="[cell, 'bg-gray-100 text-left font-semibold']">{{ h.compareOlder }}</th>
            <td :class="[cell, 'break-words']">{{ labels.older }}{{ older.participants ? ` · ${older.participants}` : '' }}</td>
            <th :class="[cell, 'bg-gray-100 text-left font-semibold']">{{ h.compareNewer }}</th>
            <td :class="[cell, 'break-words']">{{ labels.newer }}{{ newer.participants ? ` · ${newer.participants}` : '' }}</td>
          </tr>
        </tbody>
      </table>
      <FormsFormCompare :sections="sections" :older-label="labels.older" :newer-label="labels.newer" />
    </template>
  </div>
</template>
