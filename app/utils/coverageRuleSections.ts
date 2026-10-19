import type { GroupColor } from '#shared/types/api'

/** One block of the mandatory duties list in the settings. */
export interface CoverageRuleSection<T> {
  /** 'facility', 'group-<id>' or 'unknown'. */
  key: string
  /** The group of the block (null for the whole facility and for rules of a group the facility does not know). */
  groupId: number | null
  /** The group's name (null: the page names the block). */
  name: string | null
  color: GroupColor | null
  rules: T[]
}

interface SortableRule { id: number; groupId: number | null; start: number; end: number | null; label: string }

/** Start, then end (no end first), then label, then id. */
function compareRules(a: SortableRule, b: SortableRule): number {
  return a.start - b.start
    || (a.end ?? -1) - (b.end ?? -1)
    || a.label.localeCompare(b.label, 'de')
    || a.id - b.id
}

/**
 * The mandatory duties in blocks: first those of the whole facility (groupId null), then one block per group in the
 * groups' order, last the rules of a group the list does not know (should not happen). Blocks without rules are left
 * out; within a block the rules are sorted by start time, end and label.
 */
export function coverageRuleSections<T extends SortableRule>(
  rules: T[], groups: { id: number; name: string; color: GroupColor | null }[],
): CoverageRuleSection<T>[] {
  const known = new Set(groups.map(group => group.id))
  const sorted = [...rules].sort(compareRules)
  const sections: CoverageRuleSection<T>[] = [
    { key: 'facility', groupId: null, name: null, color: null, rules: sorted.filter(rule => rule.groupId === null) },
    ...groups.map(group => ({
      key: `group-${group.id}`, groupId: group.id, name: group.name, color: group.color,
      rules: sorted.filter(rule => rule.groupId === group.id),
    })),
    {
      key: 'unknown', groupId: null, name: null, color: null,
      rules: sorted.filter(rule => rule.groupId !== null && !known.has(rule.groupId)),
    },
  ]
  return sections.filter(section => section.rules.length > 0)
}
