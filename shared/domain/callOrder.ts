// The order in which a child's contacts (Bezugspersonen) are called: the phone list of the overview, its printout,
// the overview sheet "Anruf-Reihenfolge" and the "Wichtig" box of the record. The record itself keeps its own order
// (the arrows).

/** What the order needs of a contact; `emergencyRank` is "Anrufen als Nr." (1 = call first). */
export interface CallOrderContact {
  isGuardian: boolean
  emergencyRank: number | null
  contactBan: boolean
}

export interface CallOrderOptions {
  /** The others without a number (group 3); the phone list shows them, the "Wichtig" box does not. Default on. */
  withUnnumbered?: boolean
  /** The contacts with a contact ban, at the very end; only the phone list shows them (marked red). Default off. */
  withBanned?: boolean
}

/**
 * The contacts in call order, given in the record's order (sort order, then id, as the server sends them):
 * 1. the parents (sorgeberechtigt), by "Anrufen als Nr.", parents without a number after them;
 * 2. the others with a number, by number;
 * 3. the others without a number – only with `withUnnumbered`;
 * 4. the contacts with a contact ban – only with `withBanned`.
 * Equal numbers and the contacts without one keep the record's order.
 */
export function callOrder<T extends CallOrderContact>(
  contacts: readonly T[], { withUnnumbered = true, withBanned = false }: CallOrderOptions = {},
): T[] {
  const group = (contact: T): number =>
    contact.contactBan ? 3 : contact.isGuardian ? 0 : contact.emergencyRank !== null ? 1 : 2
  const rank = (contact: T): number => (contact.contactBan ? 0 : contact.emergencyRank ?? Number.MAX_SAFE_INTEGER)
  return contacts
    .map((contact, index) => ({ contact, index, group: group(contact) }))
    .filter(entry => (entry.group !== 2 || withUnnumbered) && (entry.group !== 3 || withBanned))
    .sort((a, b) => a.group - b.group || rank(a.contact) - rank(b.contact) || a.index - b.index)
    .map(({ contact }) => contact)
}
