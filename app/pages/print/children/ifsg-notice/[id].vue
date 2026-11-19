<script setup lang="ts">
import type { IfsgNoticeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The parents' notice („Aushang“) of a § 34 IfSG case, A4 portrait: no names – only the group, the disease, a short hint
 * what to watch for, the facility and the day.
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 20mm !important; } @media print { html { font-size: 16px !important; } }' }] })

const n = de.ifsg.notice
const route = useRoute()
const id = Number(route.params.id)
const { data, error } = await useFetch<IfsgNoticeDto>(`/api/ifsg/cases/${id}/notice`, { key: `print-ifsg-notice-${id}` })
useHead({ title: n.title })
</script>

<template>
  <div class="mx-auto max-w-2xl bg-white p-8 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-6 flex flex-wrap items-baseline gap-3 print:hidden">
      <PrintActions :file-name="`Aushang-${id}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <article v-else-if="data" class="space-y-6">
      <p class="text-lg font-medium text-gray-700">{{ data.facilityName }}</p>
      <h1 class="text-3xl font-bold">{{ n.title }}</h1>
      <p class="text-2xl font-semibold">{{ n.text(data.groupName, data.diseaseName) }}</p>
      <section class="space-y-2">
        <h2 class="text-lg font-semibold">{{ n.hintTitle }}</h2>
        <p class="text-lg">{{ data.hint }}</p>
        <p class="text-lg">{{ n.contact }}</p>
      </section>
      <p class="text-base">{{ n.date(formatDate(data.reportedOn)) }}</p>
      <p class="border-t border-gray-300 pt-3 text-xs text-gray-500">{{ de.ifsg.footer }}</p>
    </article>
  </div>
</template>
