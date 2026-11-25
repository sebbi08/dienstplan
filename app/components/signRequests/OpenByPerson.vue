<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { openSignPeople } from '~/utils/signRequestsOpen'

/**
 * „Wer muss noch unterschreiben?“ on top of Mitarbeitende → Unterschriften: per person what is still open, since when and
 * until when, the overdue ones in red; the name leads to the person's tab „Nachweise“ (with „Erinnern“ and
 * „Zurückziehen“). Only requests the viewer sees in the list below (the same data).
 */
const t = de.signRequests
const { data, status } = useSignRequests()
const people = computed(() => openSignPeople(data.value ?? [], todayIso()))
const personLink = (employeeId: number) => ({ path: `/admin/employees/${employeeId}`, query: { tab: 'records' } })
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200" aria-labelledby="sign-open-title">
    <h2 id="sign-open-title" class="text-lg font-semibold">{{ t.openTitle }}</h2>
    <p class="text-sm text-gray-600">{{ t.openIntro }}</p>
    <p v-if="status !== 'pending' && !people.length" class="text-sm text-gray-500">{{ t.openNone }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="person in people" :key="person.employeeId" class="space-y-1 py-2">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <NuxtLink :to="personLink(person.employeeId)" class="font-semibold text-sky-700 hover:underline">{{ person.name }}</NuxtLink>
          <span class="text-sm" :class="person.overdue ? 'font-medium text-red-700' : 'text-gray-600'">{{ t.listHintTitle(person.items.length, person.overdue) }}</span>
        </div>
        <ul class="space-y-0.5 text-sm">
          <li v-for="item in person.items" :key="item.recipient.id" class="flex flex-wrap items-baseline gap-x-2" :class="item.overdue ? 'text-red-700' : 'text-gray-700'">
            <span class="min-w-0 break-words font-medium">{{ item.request.title }}</span>
            <span>{{ t.openSince(formatDate(todayIso(new Date(item.request.createdAt)))) }}</span>
            <span v-if="item.request.dueDate">· {{ t.dueOn(formatDate(item.request.dueDate)) }}</span>
            <span v-if="item.overdue" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">{{ t.overdue }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
