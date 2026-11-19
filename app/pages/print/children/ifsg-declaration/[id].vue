<script setup lang="ts">
import type { IfsgDeclarationDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

/**
 * The parents' declaration („Elternerklärung“) of a § 34 IfSG case, A4 portrait: the structure of the health office's
 * form with the facility's name on top, the child's name and the disease filled in, lines for the physician, the days
 * and the signature.
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 20mm !important; } @media print { html { font-size: 16px !important; } }' }] })

const d = de.ifsg.declaration
const route = useRoute()
const id = Number(route.params.id)
const { data, error } = await useFetch<IfsgDeclarationDto>(`/api/ifsg/cases/${id}/declaration`, { key: `print-ifsg-declaration-${id}` })
useHead({ title: d.title })
const line = 'border-b border-gray-900 min-h-8 px-1 pb-1 text-lg'
const label = 'pt-1 text-sm text-gray-700'
</script>

<template>
  <div class="mx-auto max-w-2xl bg-white p-8 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-6 flex flex-wrap items-baseline gap-3 print:hidden">
      <PrintActions :file-name="`Elternerklaerung-${id}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <article v-else-if="data" class="space-y-10">
      <p class="text-center text-sm font-medium">{{ data.facilityName }}</p>
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-bold tracking-wide">{{ d.title }}</h1>
        <p class="font-semibold">{{ d.subtitle }}</p>
      </div>
      <div>
        <p class="text-lg">{{ d.child }}</p>
        <p :class="line">{{ data.childName }}</p>
        <p :class="label" class="text-center">{{ d.childLabel }}</p>
      </div>
      <p class="text-lg">{{ d.doctor }}</p>
      <div class="grid grid-cols-[1fr_auto_10rem] items-end gap-3">
        <div>
          <p :class="line" />
          <p :class="label">{{ d.doctorLabel }}</p>
        </div>
        <p class="pb-6 text-lg">{{ d.from }}</p>
        <div>
          <p :class="line" />
          <p :class="label">{{ d.dateLabel }}</p>
        </div>
      </div>
      <div>
        <p class="text-lg">{{ d.disease }}</p>
        <p :class="line" class="mt-4">{{ data.diseaseName }}</p>
      </div>
      <p class="text-lg">{{ d.end }}</p>
      <div class="grid grid-cols-[10rem_1fr] gap-10 pt-16">
        <div>
          <p :class="line" />
          <p :class="label">{{ d.signatureDate }}</p>
        </div>
        <div>
          <p :class="line" />
          <p :class="label">{{ d.signature }}</p>
        </div>
      </div>
    </article>
  </div>
</template>
