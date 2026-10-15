<script setup lang="ts">
import { de } from '~/locales/de'

const { rights } = useChildRights()
// Only those who maintain the records may create one (at the tablet: the person who unlocked it); everybody else goes
// back to the list.
if (!rights.value?.canEdit) await navigateTo('/children')

const lookups = useChildLookups()
await lookups.ready
// "Vormerkung anlegen" links here with ?status=waitlist, so the form starts as a waitlist entry.
const initialStatus = useRoute().query.status === 'waitlist' ? 'waitlist' : 'contract'
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-left" :label="de.children.back" to="/children" />
    <ChildrenChildMasterForm :lookups="lookups" :initial-status="initialStatus" />
  </div>
</template>
