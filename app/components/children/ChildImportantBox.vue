<script setup lang="ts">
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { phonesOf, telHref } from '~/utils/children'

/** "Wichtig" at the top of the record: contact bans (red), allergies and the emergency contacts by rank. */
const props = defineProps<{ child: ChildRecordDto }>()

const bans = computed(() => props.child.contacts.filter(contact => contact.contactBan))
const allergies = computed(() => props.child.health.allergies.trim())
const emergency = computed(() => props.child.contacts
  .filter(contact => contact.emergencyRank !== null && !contact.contactBan)
  .sort((a, b) => a.emergencyRank! - b.emergencyRank! || a.id - b.id))
const empty = computed(() => !bans.value.length && !allergies.value && !emergency.value.length)
</script>

<template>
  <section class="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
    <h2 class="flex items-center gap-2 font-semibold"><UIcon name="i-lucide-triangle-alert" class="size-5 text-amber-600" />{{ de.children.important }}</h2>
    <p v-if="empty" class="text-sm text-gray-600">{{ de.children.noImportant }}</p>

    <ul v-if="bans.length" class="space-y-1">
      <li v-for="ban in bans" :key="ban.id" class="flex items-start gap-2 rounded bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
        <UIcon name="i-lucide-ban" class="mt-0.5 size-4 shrink-0" />
        <span>{{ de.children.contactBan }}: {{ ban.name }} – {{ ban.contactBanNote }}</span>
      </li>
    </ul>

    <div v-if="allergies" class="text-sm">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-600">{{ de.children.allergies }}</h3>
      <p class="whitespace-pre-line">{{ allergies }}</p>
    </div>

    <div v-if="emergency.length" class="text-sm">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-600">{{ de.children.emergencyContacts }}</h3>
      <ol class="space-y-1">
        <li v-for="contact in emergency" :key="contact.id" class="flex flex-wrap items-baseline gap-x-3">
          <span class="font-medium">{{ contact.emergencyRank }}. {{ contact.name }}<template v-if="contact.relation"> ({{ contact.relation }})</template></span>
          <a v-for="phone in phonesOf(contact)" :key="phone.label" :href="telHref(phone.number)" class="text-sky-700 hover:underline" :title="phone.label">{{ phone.number }}</a>
        </li>
      </ol>
    </div>
  </section>
</template>
