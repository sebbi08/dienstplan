/**
 * The areas of the children page and their sub-tabs: „Heute“ (attendance, weekly overview), „Kinder“ (list, overview,
 * birthdays, documents, open confirmations) and „Planung“ (planned children, occupancy, Personalschlüssel, archive).
 * Each sub-tab keeps its own visibility; an area without a visible sub-tab is not shown. The page opens with
 * Heute → Anwesenheit unless the device remembers another visible sub-tab or the address asks for one (`?tab=`).
 */

export const CHILDREN_TABS = [
  'attendance', 'week', 'list', 'overview', 'planned', 'birthdays', 'documents', 'open', 'occupancy', 'staffing', 'archive',
] as const
export type ChildrenTab = typeof CHILDREN_TABS[number]

export const CHILDREN_AREAS = ['today', 'children', 'planning'] as const
export type ChildrenArea = typeof CHILDREN_AREAS[number]

/** The sub-tabs of each area, in their order on the page. */
export const AREA_TABS: Record<ChildrenArea, readonly ChildrenTab[]> = {
  today: ['attendance', 'week'],
  children: ['list', 'overview', 'birthdays', 'documents', 'open'],
  planning: ['planned', 'occupancy', 'staffing', 'archive'],
}

export const DEFAULT_CHILDREN_TAB: ChildrenTab = 'attendance'

/** Who looks at the page: in the office the account, at the tablet the person who unlocked it. */
export interface ChildrenViewer {
  /** Leitung or Träger. */
  isManager: boolean
  onTablet: boolean
  /** The planned children may be shown (waitlist or future contracts); always for the managers. */
  showPlanned: boolean
}

/**
 * Whether a sub-tab is shown. The whole „Planung“ is for Leitung and Träger only (also at the tablet); the planned
 * children besides need one of the tablet's switches, and the Personalschlüssel is never at the tablet (its route is
 * for the signed-in managers). The server checks every request as well.
 */
export function childrenTabVisible(tab: ChildrenTab, viewer: ChildrenViewer): boolean {
  switch (tab) {
    case 'planned': return viewer.isManager && viewer.showPlanned
    case 'occupancy':
    case 'archive': return viewer.isManager
    case 'staffing': return viewer.isManager && !viewer.onTablet
    default: return true
  }
}

/** The areas shown with their visible sub-tabs; an area without one is left out. */
export function visibleChildrenAreas(viewer: ChildrenViewer): { area: ChildrenArea; tabs: ChildrenTab[] }[] {
  return CHILDREN_AREAS
    .map(area => ({ area, tabs: AREA_TABS[area].filter(tab => childrenTabVisible(tab, viewer)) }))
    .filter(entry => entry.tabs.length > 0)
}

export function areaOfTab(tab: ChildrenTab): ChildrenArea {
  return CHILDREN_AREAS.find(area => AREA_TABS[area].includes(tab)) ?? 'today'
}

const isTab = (value: unknown): value is ChildrenTab => typeof value === 'string' && (CHILDREN_TABS as readonly string[]).includes(value)
const isArea = (value: unknown): value is ChildrenArea => typeof value === 'string' && (CHILDREN_AREAS as readonly string[]).includes(value)

/** The default sub-tab when nothing else applies: Heute → Anwesenheit, otherwise the first visible one. */
export function defaultChildrenTab(viewer: ChildrenViewer): ChildrenTab {
  if (childrenTabVisible(DEFAULT_CHILDREN_TAB, viewer)) return DEFAULT_CHILDREN_TAB
  return visibleChildrenAreas(viewer)[0]?.tabs[0] ?? DEFAULT_CHILDREN_TAB
}

/**
 * The sub-tab to open in an area: the one last used there if it is still visible, otherwise the area's first visible
 * one; null when the area has none.
 */
export function tabForArea(area: ChildrenArea, viewer: ChildrenViewer, last?: Partial<Record<ChildrenArea, ChildrenTab>>): ChildrenTab | null {
  const remembered = last?.[area]
  if (remembered && AREA_TABS[area].includes(remembered) && childrenTabVisible(remembered, viewer)) return remembered
  return AREA_TABS[area].find(tab => childrenTabVisible(tab, viewer)) ?? null
}

/**
 * The sub-tab for a requested key: an old tab key (`?tab=occupancy`, the keys of the former single tab row) opens that
 * sub-tab in its area, an area key (`?tab=planning`) the area's first visible sub-tab. Null when the key is unknown or
 * not visible to this viewer.
 */
export function requestedChildrenTab(requested: unknown, viewer: ChildrenViewer): ChildrenTab | null {
  if (isTab(requested)) return childrenTabVisible(requested, viewer) ? requested : null
  if (isArea(requested)) return tabForArea(requested, viewer)
  return null
}

/** What the device remembers: the sub-tab last open and the last one per area. */
export interface ChildrenTabMemory {
  tab: ChildrenTab | null
  last: Partial<Record<ChildrenArea, ChildrenTab>>
}

const MEMORY_KEY = 'dienstplan.childrenTab'

/** The remembered sub-tabs of this device; nothing when storage is unavailable or the value unreadable. */
export function readChildrenTabMemory(): ChildrenTabMemory {
  const memory: ChildrenTabMemory = { tab: null, last: {} }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return memory
    const { tab, last } = value as { tab?: unknown; last?: unknown }
    if (isTab(tab)) memory.tab = tab
    if (last && typeof last === 'object') {
      for (const [area, entry] of Object.entries(last)) {
        if (isArea(area) && isTab(entry) && AREA_TABS[area].includes(entry)) memory.last[area] = entry
      }
    }
  }
  catch {
    // Storage unavailable or unreadable: the page opens with its default.
  }
  return memory
}

export function writeChildrenTabMemory(memory: ChildrenTabMemory): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory))
  }
  catch {
    // Not remembered; switching still works on this page.
  }
}
