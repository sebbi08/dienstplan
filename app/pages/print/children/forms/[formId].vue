<script setup lang="ts">
import type { ChildFormDto } from '#shared/types/api'
import { childSheet } from '~/utils/forms'

/**
 * The printout of a child's observation form (A4 portrait): the child and the meeting data as header, signature lines
 * for the educator and the parents. Like the other child printouts only for Leitung and Träger (the middleware keeps
 * Mitarbeiter accounts and the tablet away; the route answers 404 to whoever may not see the form).
 */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; the form is portrait like the paper one, so its rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const route = useRoute()
const { data, error } = await useFetch<ChildFormDto>(`/api/child-forms/${Number(route.params.formId)}`)
useHead({ title: () => data.value?.title ?? '' })
</script>

<template>
  <FormsFormPrint :sheet="data ? childSheet(data) : null" :error="error" />
</template>
