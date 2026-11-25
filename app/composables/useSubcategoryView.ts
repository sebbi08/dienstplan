import type { MaybeRefOrGetter } from 'vue'
import {
  chosenChip, groupHeadings, readChipMemory, readCollapsedMemory, shownGroups, subChips, withCollapsed, writeChipMemory,
  writeCollapsedMemory, type ItemGroup, type TreeCategory,
} from '~/utils/subcategories'

/**
 * The subcategories of the open sub-tab of „Dokumente“ → „Zum Ausdrucken“ or „Wissen“: the small tabs („Alle“, „Allgemein“,
 * the subcategories, each with its count), the lists shown for the chosen one, and in „Alle“ which sections are folded
 * up. The device remembers the small tab and the folded sections per category (under the two storage keys); call
 * `readMemory` after mounting on a full page load (so the server's page matches), at once otherwise.
 */
export function useSubcategoryView<C extends TreeCategory, T>(
  storage: { chips: string; collapsed: string },
  tabKey: MaybeRefOrGetter<string | null>,
  groups: MaybeRefOrGetter<ItemGroup<C, T>[]>,
) {
  const chipMemory = ref<Record<string, string>>({})
  const collapsedMemory = ref<Record<string, string[]>>({})
  function readMemory() {
    chipMemory.value = readChipMemory(storage.chips)
    collapsedMemory.value = readCollapsedMemory(storage.collapsed)
  }

  const chips = computed(() => subChips(toValue(groups)))
  const chip = computed(() => {
    const key = toValue(tabKey)
    return chosenChip(chips.value, key ? chipMemory.value[key] : null)
  })
  function selectChip(chipKey: string | null) {
    const key = toValue(tabKey)
    if (!key || chipKey === null) return
    chipMemory.value = { ...chipMemory.value, [key]: chipKey }
    writeChipMemory(storage.chips, key, chipKey)
  }
  /** The lists shown: in „Alle“ every non-empty one (as sections), else the chosen one. */
  const shown = computed(() => shownGroups(toValue(groups), chip.value))
  /** „Alle“ shows each list as a section with its header; otherwise one plain list. */
  const sections = computed(() => groupHeadings(chip.value))

  const collapsed = computed(() => {
    const key = toValue(tabKey)
    return key ? collapsedMemory.value[key] ?? [] : []
  })
  const isOpen = (groupKey: string): boolean => !collapsed.value.includes(groupKey)
  function setOpen(groupKey: string, open: boolean) {
    const key = toValue(tabKey)
    if (!key) return
    const next = withCollapsed(collapsed.value, groupKey, !open)
    collapsedMemory.value = { ...collapsedMemory.value, [key]: next }
    writeCollapsedMemory(storage.collapsed, key, next)
  }

  return { chips, chip, selectChip, shown, sections, isOpen, setOpen, readMemory }
}
