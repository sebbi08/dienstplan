import { de } from '~/locales/de'

/** What a tile of the tablet's start page does: a mode of the start page itself, a page, or the plan printout's choice. */
export type TabletTileAction =
  | { kind: 'mode'; mode: 'stamp' | 'children' | 'sign' }
  | { kind: 'link'; to: string }
  | { kind: 'print' }

export interface TabletTile {
  key: string
  label: string
  /** A second line (e.g. „Vorlagen und Wissen“). */
  hint?: string
  icon: string
  /** The two main tiles (stamping, children) are larger. */
  big: boolean
  action: TabletTileAction
}

/**
 * The tiles of the tablet's start page, its one hub (the header only leads back here), by how often they are used:
 * Stempeln and Kinder (large), then Dokumente (Vorlagen and Wissen), Zu unterschreiben, Notizen, the plan of this month,
 * Teamsitzungen, Kontakte (only while the tablet sees contacts) and the plan printout.
 */
export function tabletStartTiles(options: { showContacts: boolean; planPath: string }): TabletTile[] {
  const tiles: (TabletTile | false)[] = [
    { key: 'stamp', label: de.terminal.title, icon: 'i-lucide-clock', big: true, action: { kind: 'mode', mode: 'stamp' } },
    { key: 'children', label: de.terminal.childrenTitle, icon: 'i-lucide-baby', big: true, action: { kind: 'mode', mode: 'children' } },
    {
      key: 'documents', label: de.terminal.documentsTitle, hint: de.terminal.documentsHint, icon: 'i-lucide-book-open', big: false,
      action: { kind: 'link', to: '/documents' },
    },
    { key: 'sign', label: de.signRequests.tabletTitle, icon: 'i-lucide-signature', big: false, action: { kind: 'mode', mode: 'sign' } },
    { key: 'notes', label: de.terminal.notesTitle, icon: 'i-lucide-sticky-note', big: false, action: { kind: 'link', to: '/notes' } },
    { key: 'plan', label: de.nav.plan, icon: 'i-lucide-calendar-range', big: false, action: { kind: 'link', to: options.planPath } },
    { key: 'teamMeetings', label: de.nav.teamMeetings, icon: 'i-lucide-users', big: false, action: { kind: 'link', to: '/team-meetings' } },
    options.showContacts && { key: 'contacts', label: de.contacts.title, icon: 'i-lucide-contact', big: false, action: { kind: 'link', to: '/contacts' } },
    { key: 'print', label: de.terminal.printPlan, icon: 'i-lucide-printer', big: false, action: { kind: 'print' } },
  ]
  return tiles.filter((tile): tile is TabletTile => tile !== false)
}
