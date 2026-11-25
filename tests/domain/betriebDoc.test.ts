import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { navMenu, type NavViewer } from '../../app/utils/navMenu'
import { effectivePermissions } from '../../shared/domain/permissionBundles'
import type { Role } from '../../shared/types/api'

/**
 * docs/BETRIEB.md (UX audit item 15): its sections are numbered once each and listed under „Inhalt“, and its section
 * „Menü“ names every entry the menu shows (so a renamed or new entry does not leave the manual behind).
 */
const doc = readFileSync(new URL('../../docs/BETRIEB.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// Outside code blocks (a shell comment there starts with „#“ too).
const lines = doc.split('\n').filter((_, index, all) => all.slice(0, index).filter(line => line.startsWith('```')).length % 2 === 0)
const sections = lines.filter(line => /^## \d+\. /.test(line)).map(line => line.slice(3))

function viewer(role: Role, extra: Partial<NavViewer> = {}): NavViewer {
  const permissions = effectivePermissions({ role })
  return {
    role, can: key => permissions.has(key), employeeId: 9, isPlanner: true, openCount: 0, unread: 0,
    today: { year: 2026, month: 10 }, staffContacts: true, ...extra,
  }
}

describe('docs/BETRIEB.md', () => {
  it('numbers its sections 1, 2, 3 … without a number twice', () => {
    expect(sections.map(title => Number(title.split('.')[0]))).toEqual(sections.map((_, index) => index + 1))
  })

  it('lists every section under „Inhalt“', () => {
    const contents = doc.slice(doc.indexOf('## Inhalt'), doc.indexOf('\n## 1. '))
    for (const title of sections) expect(contents, title).toContain(`[${title}]`)
  })

  it('names every menu entry in the section „Menü“', () => {
    const start = doc.search(/^## \d+\. Menü$/m)
    const menu = doc.slice(start, doc.indexOf('\n## ', start + 1))
    const entries = [viewer('provider'), viewer('admin'), viewer('observer'), viewer('group_lead')]
      .flatMap((account) => {
        const nav = navMenu(account)
        return [...nav.main, ...nav.mine, ...nav.more]
      })
      .map(entry => entry.label)
    for (const label of new Set(entries)) expect(menu, label).toContain(label)
    expect(menu).toContain('**Mehr**')
    expect(menu).toContain('**Meins**')
  })
})
