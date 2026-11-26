import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import type { PermissionKey } from '#shared/domain/permissions'
import type { Role } from '#shared/types/api'

/**
 * „Dokumente“ (/documents): „Vorlagen“ – the Bögen (formTemplates.manage) and the PDF templates (printTemplates.view; the
 * tablet without a permission of its own) side by side in the facility's categories, each seen with its own right – and
 * „Wissen“ (knowledge.view: every account and the tablet), each a tab. `?tab=templates|knowledge` opens one; the
 * former tabs „Bögen“ (`?tab=forms`) and „Zum Ausdrucken“ (`templates`) open „Vorlagen“, the former tab „Unterschriften“
 * (`?tab=signatures`) is a tab of Mitarbeitende now (the page sends there, app/utils/areaTabs.ts).
 */
export const DOCUMENT_TABS = ['templates', 'knowledge'] as const
export type DocumentTab = typeof DOCUMENT_TABS[number]

/** The former tab keys and the tab that replaced them (old links and bookmarks). */
const FORMER_TABS: Record<string, DocumentTab> = { forms: 'templates' }

export interface DocumentsViewer {
  role: Role
  can: (key: PermissionKey) => boolean
}

/** Whether the viewer may use the tab: „Vorlagen“ with either kind's right, „Wissen“ with knowledge.view. */
function mayUse(viewer: DocumentsViewer, tab: DocumentTab): boolean {
  if (tab === 'templates') return viewer.can('printTemplates.view') || viewer.can('formTemplates.manage')
  return viewer.can('knowledge.view')
}

/** The tabs the viewer may use, in their order; the tablet has „Vorlagen“ (the PDF templates) and „Wissen“ (read only). */
export function documentTabs(viewer: DocumentsViewer): DocumentTab[] {
  if (viewer.role === 'terminal') return ['templates', 'knowledge']
  return DOCUMENT_TABS.filter(tab => mayUse(viewer, tab))
}

/** The tab `?tab=` asks for (a former key: the tab that replaced it) when the viewer may use it, else the first one they may. */
export function chosenDocumentTab(requested: unknown, tabs: readonly DocumentTab[]): DocumentTab | null {
  const wanted = typeof requested === 'string' ? FORMER_TABS[requested] ?? requested : requested
  return tabs.find(tab => tab === wanted) ?? tabs[0] ?? null
}

/**
 * Where an old address leads (/templates and /admin/forms → „Vorlagen“): /documents with that tab, keeping the other
 * query values and the anchor.
 */
export function documentsLocation(tab: DocumentTab, from: { query: LocationQuery; hash: string }): RouteLocationRaw {
  return { path: '/documents', query: { ...from.query, tab }, hash: from.hash }
}
