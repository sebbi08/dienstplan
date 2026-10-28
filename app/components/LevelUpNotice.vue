<script setup lang="ts">
import type { EmployeeDetailDto, LevelUpDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** Yellow notice of TVöD level steps due within a month (or overdue); the Träger enters the new level with one click. */
const { data: levelUps, refresh } = await useFetch<LevelUpDto[]>('/api/level-ups')
const { can } = useCan()
const canEnterLevel = computed(() => can('employees.contractEdit'))
const emit = defineEmits<{ changed: [] }>()
const run = useAction(async () => {
  await refresh()
  emit('changed')
})

function enterLevel(item: LevelUpDto) {
  run(async () => {
    const { contract } = await $fetch<EmployeeDetailDto>(`/api/employees/${item.employeeId}`)
    await $fetch<unknown>(`/api/employees/${item.employeeId}/contract`, { method: 'PUT', body: { ...contract, payLevel: item.level } })
  }, de.common.saved)
}
</script>

<template>
  <UAlert v-if="levelUps?.length" color="warning" variant="soft" icon="i-lucide-trending-up" :title="de.contract.levelUpTitle">
    <template #description>
      <ul class="space-y-1">
        <li v-for="item in levelUps" :key="item.employeeId" class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{{ de.contract.levelUp(item.name, item.fromLevel, item.level, formatDate(item.on)) }}</span>
          <UButton
            v-if="canEnterLevel" size="xs" color="warning" variant="outline"
            :label="de.contract.enterLevel(item.level)" @click="enterLevel(item)"
          />
        </li>
      </ul>
    </template>
  </UAlert>
</template>
