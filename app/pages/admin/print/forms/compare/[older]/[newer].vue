<script setup lang="ts">
import { compareForms } from '#shared/domain/formHistory'
import type { MyTalkFormDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { compareLabels } from '~/utils/forms'

/**
 * The printout of „Mit dem vorigen Gespräch vergleichen“ (A4 portrait, Leitung and Träger): a copied staff talk form
 * (`newer`) side by side with the form it was copied from (`older`). Any other pair is refused (the address can be
 * edited by hand; the header names one employee).
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })
const h = de.formHistory

const route = useRoute()
const olderId = Number(route.params.older)
const newerId = Number(route.params.newer)
const [{ data: older, error: olderError }, { data: newer, error: newerError }] = await Promise.all([
  useFetch<MyTalkFormDto>(`/api/staff-talks/forms/${olderId}`), useFetch<MyTalkFormDto>(`/api/staff-talks/forms/${newerId}`),
])
const notPair = computed(() => !!older.value && !!newer.value && newer.value.form.source?.formId !== older.value.form.id)
const error = computed(() => olderError.value ?? newerError.value)
const sections = computed(() => (older.value && newer.value ? compareForms(newer.value.form, older.value.form) : []))
const labels = computed(() => (older.value && newer.value ? compareLabels(older.value.talk, newer.value.talk, h.talkLabel) : { older: '', newer: '' }))
const title = computed(() => (newer.value ? h.comparePreviousTitle(newer.value.form.title) : ''))
useHead({ title })
const cell = 'border border-gray-500 px-1.5 py-1 align-top'
</script>

<template>
  <div class="mx-auto max-w-4xl bg-white p-6 text-sm text-gray-900 print:max-w-none print:p-0 print:text-[11px]">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-bold print:text-[18px]">{{ title }}</h1>
      <PrintActions v-if="older && newer && !notPair" :file-name="`Vergleich-Gespraech-${olderId}-${newerId}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="notPair" class="text-red-700" role="alert">{{ h.compareNotPrevious }}</p>
    <template v-else-if="older && newer">
      <table class="mb-4 w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <th :class="[cell, 'w-[16%] bg-gray-100 text-left font-semibold']">{{ de.talks.header.name }}</th>
            <td :class="[cell, 'w-[34%] break-words']">{{ newer.employeeName }}</td>
            <th :class="[cell, 'w-[16%] bg-gray-100 text-left font-semibold']">{{ de.talks.header.facility }}</th>
            <td :class="[cell, 'w-[34%] break-words']">{{ newer.facilityName }}</td>
          </tr>
          <tr>
            <th :class="[cell, 'bg-gray-100 text-left font-semibold']">{{ h.comparePreviousOlder }}</th>
            <td :class="[cell, 'break-words']">{{ labels.older }}{{ older.talk.period ? ` · ${older.talk.period}` : '' }}</td>
            <th :class="[cell, 'bg-gray-100 text-left font-semibold']">{{ h.comparePreviousNewer }}</th>
            <td :class="[cell, 'break-words']">{{ labels.newer }}{{ newer.talk.period ? ` · ${newer.talk.period}` : '' }}</td>
          </tr>
        </tbody>
      </table>
      <FormsFormCompare :sections="sections" :older-label="labels.older" :newer-label="labels.newer" />
    </template>
  </div>
</template>
