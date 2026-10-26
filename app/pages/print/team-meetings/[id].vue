<script setup lang="ts">
import type { TeamMeetingDto } from '#shared/types/api'
import { teamSheet } from '~/utils/forms'

/**
 * The printout of a team meeting's minutes (A4 portrait): facility, group, date, time, participants and
 * Protokollführung as header, „freigegeben am … von …“ or „Entwurf – noch nicht freigegeben“ at the end. For the
 * managers and the staff accounts of the facility (the tablet never gets to /print; the route answers 404 to others).
 */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; the minutes are portrait, so this rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const route = useRoute()
const { data, error } = await useFetch<TeamMeetingDto>(`/api/team-meetings/${Number(route.params.id)}`)
useHead({ title: () => data.value?.title ?? '' })
</script>

<template>
  <FormsFormPrint :sheet="data ? teamSheet(data) : null" :error="error" />
</template>
