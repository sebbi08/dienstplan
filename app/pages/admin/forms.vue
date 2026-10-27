<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Bögen“ (under „Mehr“, Leitung and Träger): the form templates of the active facility for staff talks, child
 * observations and team meetings. Mitarbeiter and the tablet never get here (/admin is for the managers).
 */
useHead({ title: de.nav.forms })
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.nav.forms }}</h1>
    <FormsTemplateEditor />
  </div>
</template>
