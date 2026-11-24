<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * Meins → Zu unterschreiben: the documents the Leitung sent this person to sign (only their own, 403 no_employee without a
 * linked employee). Signing or declining refreshes the count in the menu.
 */
useHead({ title: de.nav.mySign })
const { user } = useUserSession()
const onChanged = () => refreshNuxtData('sign-open-count')
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.nav.mySign }}</h1>
    <p class="text-sm text-gray-600">{{ de.signRequests.myIntro }}</p>
    <UAlert v-if="user?.employeeId == null" color="warning" variant="soft" :title="de.errors.no_employee" />
    <SignRequestsMyList v-else base="/api/my/sign-requests" @changed="onChanged" />
  </div>
</template>
