<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ContactsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { contactAddress, contactsOfTab, contactTabFromQuery, contactTabs, tabCategoryName, websiteLabel } from '~/utils/contacts'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Kontakte“ to print: all contacts the viewer sees (/print/contacts/all), one category (/print/contacts/<id>) or
 * „Vom Träger“ (/print/contacts/provider), grouped by category. The server decides what the viewer sees, as on the page.
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 12px !important; } }' }] })

const t = de.contacts
const route = useRoute()
const { data, error } = await useFetch<ContactsDto>('/api/contacts', { key: 'print-contacts' })
const contacts = computed(() => data.value?.contacts ?? [])
const tabs = computed(() => contactTabs(data.value?.categories ?? [], contacts.value, false))
const tab = computed(() => contactTabFromQuery(route.params.category, tabs.value))
const title = computed(() => {
  if (tab.value === 'all') return t.title
  return t.printTitleCategory(tab.value === 'provider' ? t.fromProvider : tabCategoryName(tabs.value, tab.value) ?? '')
})
/** The contacts of the printout, in sections by category (one section when a single category is printed). */
const sections = computed(() => tabs.value
  .filter(entry => entry.key !== 'all' && (tab.value === 'all' || entry.key === tab.value))
  .map(entry => ({ key: entry.key, name: entry.key === 'provider' ? t.fromProvider : entry.category!.name, contacts: contactsOfTab(contacts.value, entry.key) }))
  .filter(section => section.contacts.length > 0))
const fileName = computed(() => title.value.replace(/[–\s]+/g, '-'))

const th = 'px-2 py-1.5 align-bottom'
const td = 'px-2 py-1.5 align-top'
</script>

<template>
  <div class="mx-auto max-w-4xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ title }}</h1>
      <PrintActions :file-name="fileName" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!sections.length" class="text-sm text-gray-600">{{ t.emptyCategory }}</p>
    <section v-for="section in sections" :key="section.key" class="mb-5">
      <h2 v-if="tab === 'all'" class="mb-1 text-lg font-semibold">{{ section.name }}</h2>
      <table class="w-full text-sm">
        <thead class="border-b border-gray-400 text-left text-xs text-gray-600 print:text-gray-900">
          <tr>
            <th :class="th">{{ t.fields.organisation }}</th>
            <th :class="th">{{ t.fields.person }}</th>
            <th :class="th">{{ t.fields.phone }} / {{ t.fields.email }}</th>
            <th :class="th">{{ t.fields.address }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contact in section.contacts" :key="contact.id" class="break-inside-avoid border-b border-gray-200">
            <td :class="td">
              <span class="font-medium">{{ contact.organisation }}</span>
              <span v-if="contact.website" class="block text-xs">{{ websiteLabel(contact.website) }}</span>
              <span v-if="contact.note" class="block whitespace-pre-line text-xs text-gray-600 print:text-gray-900">{{ contact.note }}</span>
            </td>
            <td :class="td">
              {{ contact.person }}
              <span v-if="contact.role" class="block text-xs">{{ contact.role }}</span>
            </td>
            <td :class="td" class="whitespace-nowrap">
              <span v-if="contact.phone" class="block">{{ contact.phone }}</span>
              <span v-if="contact.mobile" class="block">{{ contact.mobile }}</span>
              <span v-if="contact.email" class="block break-all whitespace-normal">{{ contact.email }}</span>
            </td>
            <td :class="td">{{ contactAddress(contact) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
