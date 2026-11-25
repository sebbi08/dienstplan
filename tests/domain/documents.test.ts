import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  it('shows each viewer the tabs they may use: managers all four, Mitarbeiter and the tablet „Vorlagen“ and „Wissen“', () => {
    expect(documentTabs(as('provider'))).toEqual(['forms', 'templates', 'knowledge', 'signatures'])
    expect(documentTabs(as('admin'))).toEqual(['forms', 'templates', 'knowledge', 'signatures'])
    expect(documentTabs({ role: 'admin', can: key => key === 'signRequests.manage' })).toEqual(['signatures'])
    expect(documentTabs(as('observer'))).toEqual(['templates', 'knowledge'])
    expect(documentTabs(as('terminal'))).toEqual(['templates', 'knowledge'])
    expect(documentTabs({ role: 'observer', can: key => key === 'knowledge.view' })).toEqual(['knowledge'])
    expect(documentTabs({ role: 'observer', can: key => key === 'formTemplates.manage' })).toEqual(['forms'])
    expect(documentTabs({ role: 'observer', can: () => false })).toEqual([])
  })

  it('opens the tab the address asks for when the viewer may use it, else the first', () => {
    expect(chosenDocumentTab('templates', ['forms', 'templates'])).toBe('templates')
    expect(chosenDocumentTab(undefined, ['forms', 'templates'])).toBe('forms')
    expect(chosenDocumentTab('forms', ['templates'])).toBe('templates')
    expect(chosenDocumentTab('unknown', ['templates'])).toBe('templates')
    expect(chosenDocumentTab('forms', [])).toBeNull()
  })

  it('sends the old addresses to their tab, keeping the other query values and the anchor', () => {
    expect(documentsLocation('templates', { query: {}, hash: '' })).toEqual({ path: '/documents', query: { tab: 'templates' }, hash: '' })
    expect(documentsLocation('forms', { query: { x: '1', tab: 'old' }, hash: '#unfaelle' }))
      .toEqual({ path: '/documents', query: { x: '1', tab: 'forms' }, hash: '#unfaelle' })
  })

  it('redirects /templates to „Vorlagen“ and /admin/forms to „Bögen“; the tablet\'s start page links to „Dokumente“', () => {
    const page = (path: string) => readFileSync(join(process.cwd(), 'app', 'pages', path), 'utf8')
    expect(page('templates.vue')).toContain("definePageMeta({ redirect: to => documentsLocation('templates', to) })")
    expect(page('admin/forms.vue')).toContain("definePageMeta({ redirect: to => documentsLocation('forms', to) })")
    // One tile „Dokumente“ (Vorlagen and Wissen) on the tablet's start page.
    expect(tabletStartTiles({ showContacts: false, planPath: '/plan/2026/11' }).find(tile => tile.key === 'documents')!.action).toEqual({ kind: 'link', to: '/documents' })
  })
})
