<script setup lang="ts">
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Unfälle“ in the record: the child's accident reports. Whoever keeps the child's attendance fills one in („Unfallbericht
 * ausfüllen“, at the tablet as the unlocked person, photos with the camera); the author and Leitung/Träger change it,
 * Leitung/Träger delete it. Printing in the office only (the tablet never prints child data).
 */
const props = defineProps<{ child: ChildRecordDto }>()
const { onTablet } = useChildRights()
</script>

<template>
  <ChildrenChildSection :title="de.accidents.section" :can-edit="false">
    <AccidentsAccidentList
      subject="child" :list-url="`/api/children/${props.child.id}/accidents`" form-base="/api/child-accidents"
      attachment-base="/api/child-accident-attachments" :print-base="onTablet ? null : '/print/children/accidents'"
      :on-tablet="onTablet" :archived="child.status === 'archived'"
    />
  </ChildrenChildSection>
</template>
