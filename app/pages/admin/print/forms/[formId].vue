<script setup lang="ts">
import type { MyTalkFormDto } from '#shared/types/api'

/** The printout of a staff talk's form for Leitung and Träger (A4 portrait). */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; the form is portrait like the paper one, so its rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const route = useRoute()
const { data, error } = await useFetch<MyTalkFormDto>(`/api/staff-talks/forms/${Number(route.params.formId)}`)
useHead({ title: () => data.value?.form.title ?? '' })
</script>

<template>
  <FormsFormPrint :data="data" :error="error" />
</template>
