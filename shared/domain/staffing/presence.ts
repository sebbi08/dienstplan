import type { Minutes } from '../types'
import { isFachkraft, shareOf } from './calc'
import type { Phase, PresenceRule, PresenceSlot, Shortfall, StaffingRuleSet } from './types'

export const SLOT_MINUTES = 15

const EPSILON = 1e-9

interface Need { staff: number; fachkraft: number }

function ruleApplies(rule: PresenceRule, phase: Phase, groupType: string | null, childCount: number): boolean {
  if (rule.window !== 'always' && rule.window !== phase) return false
  if (rule.groupTypes !== undefined && (groupType === null || !rule.groupTypes.includes(groupType))) return false
  return childCount >= (rule.minChildren ?? 1)
}

function needOf(rule: PresenceRule, slot: PresenceSlot): Need {
  let staff = rule.minStaff ?? 0
  let fachkraft = rule.minFachkraft ?? 0
  const relax = rule.relaxFachkraft
  if (relax !== undefined && slot.children.length <= relax.maxChildren) fachkraft = Math.min(fachkraft, relax.minFachkraft)
  if (rule.perChildren !== undefined && rule.perChildren.children > 0) {
    const weighted = slot.children.reduce((sum, c) => sum + (rule.childWeights?.[c.ageBand] ?? 1), 0)
    const blocks = Math.ceil(weighted / rule.perChildren.children - EPSILON)
    staff = Math.max(staff, blocks * rule.perChildren.staff)
    fachkraft = Math.max(fachkraft, blocks * (rule.perChildren.fachkraft ?? 0))
  }
  return { staff, fachkraft }
}

/**
 * Presence check per 15-minute slot: staff present vs. the strictest applicable presence rule.
 * Children present = a slot with no children needs nothing. Staff count as Kraft with a share above 0.
 * A total-staff gap is reported only if more Fachkräfte alone would not close it.
 * Consecutive slots with the same gap are merged into one shortfall [from, to).
 */
export function presenceShortfalls(
  rules: StaffingRuleSet,
  slots: PresenceSlot[],
  phase: (minute: Minutes) => Phase,
  groupType: string | null = null,
): Shortfall[] {
  if (rules.presence.length === 0) return []
  const raw: Shortfall[] = []
  for (const slot of [...slots].sort((a, b) => a.minute - b.minute)) {
    const slotPhase = phase(slot.minute)
    const applicable = rules.presence.filter(r => ruleApplies(r, slotPhase, groupType, slot.children.length))
    if (applicable.length === 0) continue
    const need = applicable.map(r => needOf(r, slot)).reduce(
      (a, b) => ({ staff: Math.max(a.staff, b.staff), fachkraft: Math.max(a.fachkraft, b.fachkraft) }),
    )
    const counted = slot.staff.filter(s => shareOf(rules, s.qualification, s.share) > 0)
    const haveStaff = counted.length
    const haveFachkraft = counted.filter(s => isFachkraft(rules, s.qualification)).length
    const fachkraftGap = Math.max(0, need.fachkraft - haveFachkraft)
    const to = slot.minute + SLOT_MINUTES
    if (fachkraftGap > 0) raw.push({ from: slot.minute, to, have: haveFachkraft, need: need.fachkraft, fachkraft: true })
    if (haveStaff + fachkraftGap < need.staff) raw.push({ from: slot.minute, to, have: haveStaff, need: need.staff, fachkraft: false })
  }
  return mergeShortfalls(raw)
}

const byStart = (a: Shortfall, b: Shortfall) => a.from - b.from || Number(b.fachkraft) - Number(a.fachkraft)

/** Merges touching shortfalls of the same kind and counts (input in any order); sorted by start, Fachkraft gaps first. */
export function mergeShortfalls(shortfalls: Shortfall[]): Shortfall[] {
  const open = new Map<string, Shortfall>()
  const merged: Shortfall[] = []
  for (const s of [...shortfalls].sort(byStart)) {
    const key = `${s.fachkraft}|${s.have}|${s.need}`
    const last = open.get(key)
    if (last !== undefined && last.to === s.from) {
      last.to = s.to
      continue
    }
    const copy = { ...s }
    open.set(key, copy)
    merged.push(copy)
  }
  return merged.sort(byStart)
}
