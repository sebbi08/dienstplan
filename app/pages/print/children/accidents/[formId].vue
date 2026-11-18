<script setup lang="ts">
import type { AccidentFormDto } from '#shared/types/api'
import { accidentSheet } from '~/utils/forms'

/**
 * The printout of a child's accident report (A4 portrait): the child, Datum, Uhrzeit, Arztbesuch and „gemeldet am“ as
 * header, the answers, signature lines and the attachments by name. Like the other child printouts only in the office
 * (the middleware keeps Mitarbeiter accounts and the tablet away; the route answers 404 to whoever may not see it).
 */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; the form is portrait like the paper one, so its rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const route = useRoute()
const { data, error } = await useFetch<AccidentFormDto>(`/api/child-accidents/${Number(route.params.formId)}`)
useHead({ title: () => data.value?.title ?? '' })
</script>

<template>
  <FormsFormPrint :sheet="data ? accidentSheet(data) : null" :error="error" />
</template>
