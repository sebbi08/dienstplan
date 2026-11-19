/**
 * Reasons for „Sonderurlaub“ (Arbeitsbefreiung, TVöD § 29), with the usual days in the label (de.ts
 * specialLeave.reasons). „Sonstiges“ needs a free text; a free text is allowed with any reason. The reason is shown only
 * to Leitung, Träger and the employee themselves, never in the plan, at the tablet or to colleagues.
 */
export const SPECIAL_LEAVE_REASONS = [
  'birth', 'death', 'move', 'jubilee', 'relative_ill', 'child_ill', 'carer_ill', 'other',
] as const
export type SpecialLeaveReason = typeof SPECIAL_LEAVE_REASONS[number]
export const SPECIAL_LEAVE_TEXT_MAX = 200

export const isSpecialLeaveReason = (value: unknown): value is SpecialLeaveReason =>
  typeof value === 'string' && (SPECIAL_LEAVE_REASONS as readonly string[]).includes(value)

/**
 * The reason as stored: a known key (else special_leave_reason_invalid), the text trimmed (empty = none, at most 200
 * characters, else special_leave_text_too_long); „Sonstiges“ needs a text (special_leave_text_required). No reason and
 * no text = none.
 */
export function checkedSpecialLeaveReason(
  reason: string | null | undefined, text: string | null | undefined,
): { reason: SpecialLeaveReason | null; text: string | null } | { error: string } {
  const trimmed = text?.trim() || null
  if (reason == null) return trimmed === null ? { reason: null, text: null } : { error: 'special_leave_reason_invalid' }
  if (!isSpecialLeaveReason(reason)) return { error: 'special_leave_reason_invalid' }
  if (trimmed !== null && trimmed.length > SPECIAL_LEAVE_TEXT_MAX) return { error: 'special_leave_text_too_long' }
  if (reason === 'other' && trimmed === null) return { error: 'special_leave_text_required' }
  return { reason, text: trimmed }
}
