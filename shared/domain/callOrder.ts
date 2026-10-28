// The order in which a child's contacts (Bezugspersonen) are called: the phone list of the overview, its printout and
// the "Wichtig" box of the record. The record itself keeps its own order (the arrows).

/** What the order needs of a contact; `emergencyRank` is "Anrufen als Nr." (1 = call first). */
export interface CallOrderContact {
  isGuardian: boolean
  emergencyRank: number | null
  contactBan: boolean
}

/**
 * The contacts in call order, given in the record's order (sort order, then id, as the server sends them):
 * 1. the parents (sorgeberechtigt), by "Anrufen als Nr.", parents without a number after them;
 * 2. the others with a number, by number;
 * 3. the others without a number – only with `withUnnumbered` (the phone list; the "Wichtig" box leaves them out).
 * Equal numbers and the contacts without one keep the record's order. A contact with a contact ban never appears.
 */
export function callOrder<T extends CallOrderContact>(contacts: readonly T[], { withUnnumbered = true } = {}): T[] {
  const group = (contact: T): number => (contact.isGuardian ? 0 : contact.emergencyRank !== null ? 1 : 2)
  return contacts
    .map((contact, index) => ({ contact, index }))
    .filter(({ contact }) => !contact.contactBan && (withUnnumbered || group(contact) < 2))
    .sort((a, b) => group(a.contact) - group(b.contact)
      || (a.contact.emergencyRank ?? Number.MAX_SAFE_INTEGER) - (b.contact.emergencyRank ?? Number.MAX_SAFE_INTEGER)
      || a.index - b.index)
    .map(({ contact }) => contact)
}
