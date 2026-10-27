<script setup lang="ts">
import type { FormTemplateDto } from '#shared/types/api'
import { blankSheet } from '~/utils/forms'

/** A form template printed blank (A4 portrait), to fill in by hand; Leitung and Träger, from Mehr → Bögen. */
definePageMeta({ layout: false })
// The app-wide print rule sets A4 landscape; the form is portrait like the paper one, so its rule must win.
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; }' }] })

const route = useRoute()
const id = Number(route.params.id)
const { activeName } = useFacilities()
const { data, error } = await useFetch<FormTemplateDto[]>('/api/form-templates', { default: () => [] })
const template = computed(() => (data.value ?? []).find(entry => entry.id === id) ?? null)
useHead({ title: () => template.value?.name ?? '' })
</script>

<template>
  <FormsFormPrint :sheet="template ? blankSheet(template, activeName ?? '') : null" :error="error" />
</template>
