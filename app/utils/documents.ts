import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import type { PermissionKey } from '#shared/domain/permissions'
import type { Role } from '#shared/types/api'

/**
 * „Dokumente“ (/documents): the form templates („Bögen“, formTemplates.manage) and the blank forms to print („Vorlagen“,
 * printTemplates.view; the tablet without a permission of its own) and „Wissen“ (knowledge.view: every account and the
 * tablet) and „Unterschriften“ (the requests to sign sent from the facility, signRequests.manage), each a tab.
 * `?tab=forms|templates|knowledge|signatures` opens one.
 */
export const DOCUMENT_TABS = ['forms', 'templates', 'knowledge', 'signatures'] as const
export type DocumentTab = typeof DOCUMENT_TABS[number]

const TAB_KEYS: Record<DocumentTab, PermissionKey> = {
  forms: 'formTemplates.manage', templates: 'printTemplates.view', knowledge: 'knowledge.view', signatures: 'signRequests.manage',
}

export interface DocumentsViewer {
  role: Role
  can: (key: PermissionKey) => boolean
}

/** The tabs the viewer may use, in their order; the tablet has the print templates and „Wissen“ (read only). */
export function documentTabs(viewer: DocumentsViewer): DocumentTab[] {
  if (viewer.role === 'terminal') return ['templates', 'knowledge']
  return DOCUMENT_TABS.filter(tab => viewer.can(TAB_KEYS[tab]))
}

/** The tab `?tab=` asks for when the viewer may use it, else the first one they may. */
export function chosenDocumentTab(requested: unknown, tabs: readonly DocumentTab[]): DocumentTab | null {
  return tabs.find(tab => tab === requested) ?? tabs[0] ?? null
}

/**
 * Where an old address leads (/templates → „Vorlagen“, /admin/forms → „Bögen“): /documents with that tab, keeping the
 * other query values and the anchor.
 */
export function documentsLocation(tab: DocumentTab, from: { query: LocationQuery; hash: string }): RouteLocationRaw {
  return { path: '/documents', query: { ...from.query, tab }, hash: from.hash }
}
