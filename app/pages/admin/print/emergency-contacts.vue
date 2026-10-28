<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EmergencyContactListRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Notfallkontakte aller Mitarbeiter“ (Leitung and Träger): the employees who have not left, in the order of the staff
 * list, each with their emergency contacts in call order.
 */
definePageMeta({ layout: false })
// A list to hang up: A4 portrait over the full page width (the shared print rule is landscape with 10px).
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 13.5px !important; } table td, table th { padding-top: 3px !important; padding-bottom: 3px !important; } }' }] })

const { data: rows, error } = await useFetch<EmergencyContactListRowDto[]>('/api/emergency-contacts')
const t = de.emergencyContacts
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ t.printTitle }}</h1>
      <PrintActions :file-name="t.printFileName" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!rows?.length" class="text-gray-600">{{ t.printEmpty }}</p>
    <table v-else class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b-2 border-gray-400 text-left">
          <th class="w-1/4 py-1 pr-2">{{ de.employees.name }}</th>
          <th class="w-6 py-1 pr-1" />
          <th class="py-1 pr-2">{{ t.fields.name }} ({{ t.fields.relation }})</th>
          <th class="py-1 pr-2">{{ t.fields.phone }}</th>
          <th class="py-1 pr-2">{{ t.fields.phone2 }}</th>
          <th class="py-1">{{ t.fields.note }}</th>
        </tr>
      </thead>
      <tbody v-for="row in rows" :key="row.employeeId" class="break-inside-avoid border-b border-gray-300">
        <tr v-if="!row.contacts.length">
          <td class="py-1 pr-2 align-top font-semibold">{{ row.name }}</td>
          <td colspan="5" class="py-1 align-top italic text-gray-500">{{ t.printNone }}</td>
        </tr>
        <tr v-for="(contact, index) in row.contacts" :key="contact.id">
          <td class="py-1 pr-2 align-top font-semibold">{{ index === 0 ? row.name : '' }}</td>
          <td class="py-1 pr-1 align-top text-gray-500">{{ t.order(index + 1) }}</td>
          <td class="py-1 pr-2 align-top">
            {{ contact.name }}<span v-if="contact.relation" class="text-gray-600"> ({{ contact.relation }})</span>
          </td>
          <td class="whitespace-nowrap py-1 pr-2 align-top">{{ contact.phone }}</td>
          <td class="whitespace-nowrap py-1 pr-2 align-top">{{ contact.phone2 }}</td>
          <td class="whitespace-pre-line py-1 align-top text-gray-700">{{ contact.note }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mt-3 text-xs text-gray-500">{{ t.printHint }}</p>
    <p class="mt-1 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
