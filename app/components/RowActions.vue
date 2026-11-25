<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { de } from '~/locales/de'
import { rowActionSplit, type RowAction } from '~/utils/rowActions'

/**
 * The buttons of one list row („Zum Ausdrucken“, „Bögen“, „Wissen“, „Kontakte“): on phones (below 640 px) only the
 * first one as a button and the others in a „⋯“ menu, so a row keeps one line of buttons and „Löschen“ is not tapped by
 * mistake; from 640 px all of them in a row as before. `name` names the row for screen readers („Weitere Aktionen: …“).
 */
const props = withDefaults(defineProps<{ actions: readonly RowAction[]; name: string; size?: 'xs' | 'sm' }>(), { size: 'sm' })
const split = computed(() => rowActionSplit(props.actions))
const menuItems = computed<DropdownMenuItem[]>(() => split.value.rest.map(action => ({
  label: action.label, icon: action.icon, color: action.color === 'error' ? 'error' : undefined, disabled: action.disabled,
  ...(action.to ? { to: action.to, target: action.target, external: action.external } : {}),
  ...(action.onClick ? { onSelect: () => { action.onClick!() } } : {}),
})))
/** The props of an action's button (icon only from 640 px when asked; the label then names it). */
const buttonOf = (action: RowAction) => ({
  size: props.size, color: action.color ?? 'neutral', variant: action.variant ?? 'outline', icon: action.icon,
  disabled: action.disabled, title: action.title ?? (action.iconOnly ? action.label : undefined),
  ...(action.iconOnly ? { 'aria-label': `${action.label}: ${props.name}` } : { label: action.label }),
  ...(action.to ? { to: action.to, target: action.target, external: action.external } : {}),
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-1">
    <UButton v-if="split.primary" v-bind="buttonOf(split.primary)" @click="split.primary.onClick?.()" />
    <UButton v-for="action in split.rest" :key="action.key" v-bind="buttonOf(action)" class="max-sm:hidden" @click="action.onClick?.()" />
    <UDropdownMenu v-if="split.rest.length" :items="menuItems" :content="{ align: 'end' }">
      <UButton
        :size="size" color="neutral" variant="ghost" icon="i-lucide-ellipsis" class="min-h-10 min-w-10 justify-center sm:hidden"
        :aria-label="de.common.moreActions(name)" :title="de.common.moreActions(name)"
      />
    </UDropdownMenu>
  </div>
</template>
