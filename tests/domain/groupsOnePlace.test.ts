import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AREA_SECTIONS, GROUP_SECTIONS } from '../../app/utils/settingsAreas'

/** A component's source (the requests it makes and the controls it renders). */
const source = (path: string) => readFileSync(path, 'utf8')
/** The requests that change a group: rename / delete (`/api/groups/<id>` PUT/DELETE), flags, read access, order. */
const EDITS = [
  /\/api\/groups\/\$\{[^}]+\}`, \{ method: 'PUT'/, /\/api\/groups\/\$\{[^}]+\}`, \{ method: 'DELETE'/, /school-children/, /group-read-access/,
  /GroupReadAccess/, /\/move`/,
]

/**
 * Groups in one place (UX wave B): everything about a group is changed on its page (Einstellungen → Gruppen → Gruppe);
 * the facility's card and the group list only list the groups, open their page and add new ones.
 */
describe('group editing only on the group page', () => {
  it('leaves the facility card with a list, the link to each page and „Gruppe anlegen“ only', () => {
    const card = source('app/components/settings/FacilityGroups.vue')
    for (const edit of EDITS) expect(card, String(edit)).not.toMatch(edit)
    expect(card).toContain('<SettingsGroupCreateForm')
    expect(card).toContain('groupPath(group.id)')
    // The create form only creates (and sets Gruppenart and Plätze of the new group).
    const create = source('app/components/settings/GroupCreateForm.vue')
    expect(create).toContain("method: 'POST'")
    expect(create).not.toMatch(/method: 'DELETE'/)
    expect(create).not.toMatch(/school-children|group-read-access/)
  })

  it('keeps rename, delete, the Schulkinder flag and read access on the group page', () => {
    const name = source('app/components/settings/GroupNameSection.vue')
    expect(name).toMatch(EDITS[0]!)
    expect(name).toMatch(EDITS[1]!)
    expect(name).toContain('school-children')
    expect(source('app/components/settings/GroupBooksSection.vue')).toContain('SettingsGroupReadAccess')
    expect(GROUP_SECTIONS.map(section => section.key)).toEqual(expect.arrayContaining(['group-name', 'group-read-access', 'group-type', 'group-capacity', 'group-hours']))
  })

  it('has no section of an area that edits a group (the group list only orders them)', () => {
    const areaKeys = Object.values(AREA_SECTIONS).flat().map(section => section.key)
    for (const key of GROUP_SECTIONS.map(section => section.key)) expect(areaKeys, key).not.toContain(key)
    const list = source('app/components/settings/GroupListSection.vue')
    expect(list).not.toMatch(EDITS[0]!)
    expect(list).not.toMatch(EDITS[1]!)
    expect(list).not.toMatch(/school-children|group-read-access/)
  })
})
