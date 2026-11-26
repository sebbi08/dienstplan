import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { signaturesLocation } from '../../app/utils/areaTabs'
import { chosenDocumentTab, documentsLocation, documentTabs } from '../../app/utils/documents'
import { tabletStartTiles } from '../../app/utils/tabletStart'
import { effectivePermissions } from '../../shared/domain/permissionBundles'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { Role } from '../../shared/types/api'

/** The role with its default permissions. */
function as(role: Role) {
  const permissions = effectivePermissions({ role })
  return { role, can: (key: PermissionKey) => permissions.has(key) }
}

describe('„Dokumente“', () => {
  it('names the tabs by what is in them: „Vorlagen“ (Bögen and PDFs) with a short line, and „Wissen“', () => {
    expect(de.documents.tabs).toEqual({ templates: 'Vorlagen', knowledge: 'Wissen' })
    expect(de.documents.tabHints.templates).toBe('Bögen zum Ausfüllen im Programm und PDF-Formulare')
    expect(de.documents.tabHints.knowledge).toBe('')
  })

  it('shows each viewer the tabs they may use: „Vorlagen“ with either kind\'s right, „Wissen“; the tablet both', () => {
    expect(documentTabs(as('provider'))).toEqual(['templates', 'knowledge'])
    expect(documentTabs(as('admin'))).toEqual(['templates', 'knowledge'])
    // „Unterschriften“ is a tab of Mitarbeitende now.
    expect(documentTabs({ role: 'admin', can: key => key === 'signRequests.manage' })).toEqual([])
    expect(documentTabs(as('observer'))).toEqual(['templates', 'knowledge'])
    expect(documentTabs(as('terminal'))).toEqual(['templates', 'knowledge'])
    expect(documentTabs({ role: 'observer', can: key => key === 'knowledge.view' })).toEqual(['knowledge'])
    expect(documentTabs({ role: 'observer', can: key => key === 'formTemplates.manage' })).toEqual(['templates'])
    expect(documentTabs({ role: 'observer', can: key => key === 'printTemplates.view' })).toEqual(['templates'])
    expect(documentTabs({ role: 'observer', can: () => false })).toEqual([])
  })

  it('opens the tab the address asks for when the viewer may use it (the former „Bögen“: „Vorlagen“), else the first', () => {
    expect(chosenDocumentTab('knowledge', ['templates', 'knowledge'])).toBe('knowledge')
    expect(chosenDocumentTab('templates', ['templates', 'knowledge'])).toBe('templates')
    expect(chosenDocumentTab('forms', ['templates', 'knowledge'])).toBe('templates')
    expect(chosenDocumentTab(undefined, ['templates', 'knowledge'])).toBe('templates')
    expect(chosenDocumentTab('forms', ['knowledge'])).toBe('knowledge')
    expect(chosenDocumentTab('unknown', ['knowledge'])).toBe('knowledge')
    expect(chosenDocumentTab('forms', [])).toBeNull()
  })

  it('sends the old addresses to their tab, keeping the other query values and the anchor', () => {
    expect(documentsLocation('templates', { query: {}, hash: '' })).toEqual({ path: '/documents', query: { tab: 'templates' }, hash: '' })
    expect(documentsLocation('templates', { query: { x: '1', tab: 'old' }, hash: '#unfaelle' }))
      .toEqual({ path: '/documents', query: { x: '1', tab: 'templates' }, hash: '#unfaelle' })
  })

  it('sends the former tab „Unterschriften“ (?tab=signatures) to the tab of Mitarbeitende, keeping the rest of the address', () => {
    expect(signaturesLocation({ query: { tab: 'signatures' }, hash: '' })).toEqual({ path: '/admin/employees/signatures', query: {}, hash: '' })
    expect(signaturesLocation({ query: { tab: 'signatures', x: '1' }, hash: '#a' })).toEqual({ path: '/admin/employees/signatures', query: { x: '1' }, hash: '#a' })
    const page = readFileSync(join(process.cwd(), 'app', 'pages', 'documents.vue'), 'utf8')
    expect(page).toContain("to.query.tab === 'signatures' ? navigateTo(signaturesLocation(to), { replace: true }) : undefined")
    expect(page).not.toContain('SignRequestsOverview')
  })

  it('redirects /templates and /admin/forms to „Vorlagen“; the tablet\'s start page links to „Dokumente“', () => {
    const page = (path: string) => readFileSync(join(process.cwd(), 'app', 'pages', path), 'utf8')
    expect(page('templates.vue')).toContain("definePageMeta({ redirect: to => documentsLocation('templates', to) })")
    expect(page('admin/forms.vue')).toContain("definePageMeta({ redirect: to => documentsLocation('templates', to) })")
    // One tile „Dokumente“ („Vorlagen“ and „Wissen“) on the tablet's start page.
    expect(tabletStartTiles({ showContacts: false, planPath: '/plan/2026/11' }).find(tile => tile.key === 'documents')!.action).toEqual({ kind: 'link', to: '/documents' })
  })
})
