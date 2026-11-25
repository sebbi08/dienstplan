<script setup lang="ts">
import { accidentsLocation } from '~/utils/areaTabs'

/**
 * The old address of Mehr → „Unfälle“: now the tabs „Unfälle“ of Kinder (all, children) and of Mitarbeitende
 * (`filter=employee`, or whoever does not open the children's pages with the own account); the year stays. Bookmarks and
 * old links keep working.
 */
definePageMeta({
  middleware: [(to) => {
    const { can } = useCan()
    return navigateTo(accidentsLocation(to, { children: can('children.ownAccount') }), { replace: true })
  }],
})
</script>

<template>
  <div />
</template>
