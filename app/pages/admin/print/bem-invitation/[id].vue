<script setup lang="ts">
import type { BemInvitationDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The invitation to a BEM (§ 167 Abs. 2 SGB IX), A4 portrait, for Leitung and Träger (employees.sickness): the
 * facility's name, Träger, address and phone as letterhead, the employee's name and address (blank lines when not stored or the viewer
 * may not read personal data), place and date, the facility's text (Einstellungen → Personal → BEM-Einladung) and the
 * contact person for questions, the closing with the sender's signature line, and the reply slip „Ich nehme teil / Ich
 * nehme nicht teil“ with the signature line.
 */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; a letter is portrait, so its rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 20mm 20mm 15mm 25mm !important; }' }] })

const t = de.bem.print
const route = useRoute()
const id = Number(route.params.id)
const { data, error } = await useFetch<BemInvitationDto>(`/api/bem/${id}/invitation`, { key: `print-bem-invitation-${id}` })
useHead({ title: t.title })

const paragraphs = computed(() => (data.value?.text ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean))
const cityLine = (postalCode: string, city: string) => [postalCode, city].filter(Boolean).join(' ')
const hasAddress = computed(() => !!data.value && !!(data.value.employee.street || data.value.employee.city))
const line = 'border-b border-gray-900 min-h-7'
const label = 'pt-1 text-xs text-gray-700'
</script>

<template>
  <div class="mx-auto max-w-2xl bg-white p-8 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-6 flex flex-wrap items-baseline gap-3 print:hidden">
      <PrintActions :file-name="`BEM-Einladung-${id}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <article v-else-if="data" class="space-y-6 text-[15px] leading-relaxed">
      <header class="text-right text-sm">
        <p class="font-semibold">{{ data.facility.name }}</p>
        <p v-if="data.facility.operator">{{ t.operator(data.facility.operator) }}</p>
        <p v-if="data.facility.street">{{ data.facility.street }}</p>
        <p v-if="data.facility.postalCode || data.facility.city">{{ cityLine(data.facility.postalCode, data.facility.city) }}</p>
        <p v-if="data.facility.phone">{{ t.phone(data.facility.phone) }}</p>
      </header>

      <div class="min-h-28 w-72">
        <p>{{ data.employee.name }}</p>
        <template v-if="hasAddress">
          <p v-if="data.employee.street">{{ data.employee.street }}</p>
          <p>{{ cityLine(data.employee.postalCode, data.employee.city) }}</p>
        </template>
        <template v-else>
          <p :class="line" class="mt-2" />
          <p :class="line" />
          <p :class="label">{{ t.addressBlank }}</p>
        </template>
      </div>

      <p class="text-right">{{ t.date(data.facility.city, formatDate(data.date)) }}</p>
      <h1 class="text-lg font-bold">{{ t.title }}</h1>
      <p v-for="(paragraph, index) in paragraphs" :key="index" class="whitespace-pre-line">{{ paragraph }}</p>
      <p>{{ t.contact(data.contact.name, data.contact.phone) }}</p>
      <div class="break-inside-avoid">
        <p>{{ t.closing }}</p>
        <div class="w-72 pt-12">
          <p :class="line" />
          <p :class="label">{{ t.senderSignature(data.contact.name) }}</p>
        </div>
      </div>

      <section class="break-inside-avoid space-y-4 border-t-2 border-dashed border-gray-400 pt-6">
        <h2 class="font-bold">{{ t.reply }}</h2>
        <p class="text-sm">{{ t.replyTo(data.facility.name) }}</p>
        <div>
          <p :class="line" class="px-1">{{ data.employee.name }}</p>
          <p :class="label">{{ t.replyName }}</p>
        </div>
        <p class="flex items-center gap-3"><span class="inline-block size-5 border-2 border-gray-900" aria-hidden="true" />{{ t.yes }}</p>
        <p class="flex items-center gap-3"><span class="inline-block size-5 border-2 border-gray-900" aria-hidden="true" />{{ t.no }}</p>
        <div class="pt-10">
          <p :class="line" />
          <p :class="label">{{ t.signature }}</p>
        </div>
      </section>
    </article>
  </div>
</template>
