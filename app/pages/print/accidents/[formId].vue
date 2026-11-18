<script setup lang="ts">
import type { AccidentFormDto } from '#shared/types/api'
import { accidentSheet } from '~/utils/forms'
import { u1000Sheet } from '~/utils/u1000'

/**
 * The printout of an accident report about an employee (A4 portrait): from the U 1000 starter in the layout of the
 * official Unfallanzeige, to sign and send to the Unfallkasse; from another template like every Bogen. For Leitung/Träger
 * and the employee themselves (the route answers 404 to anybody else; the tablet never gets here).
 */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; the official form is portrait, so its rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 10mm !important; }' }] })

const route = useRoute()
const { data, error } = await useFetch<AccidentFormDto>(`/api/employee-accidents/${Number(route.params.formId)}`)
useHead({ title: () => data.value?.title ?? '' })
</script>

<template>
  <AccidentsU1000Print v-if="data?.printLayout === 'u1000'" :sheet="u1000Sheet(data)" :error="error" />
  <FormsFormPrint v-else :sheet="data ? accidentSheet(data) : null" :error="error" />
</template>
