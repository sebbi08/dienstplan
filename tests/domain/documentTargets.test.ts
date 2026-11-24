import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import {
  emptyTargets, facilitiesForGroups, facilitiesLost, hasEmptyGroupLimit, isOrphanTargets, setGroupLimit, targetHints, targetsFormOf, targetsNeedChoice, targetsPayload, targetsProblem,
  toggleGroup, toggleId,
} from '../../app/utils/documentTargets'
import {
  facilitiesLosing, groupsAllow, inFacilityScope, reachesAudience, scopeOf, spansFacilities, type ItemTargets,
} from '../../shared/domain/documentTargets'
import { matchesSearch, searchFold } from '../../shared/domain/search'
import { knowledgeMatches } from '../../shared/domain/knowledge'
import type { DocumentTargetOptionsDto, DocumentTargetsDto } from '../../shared/types/api'

const targets = (allFacilities: boolean, facilities: [number, boolean][], groups: [number, number[]][] = []): ItemTargets => ({
  allFacilities, facilities: new Map(facilities), groups: new Map(groups.map(([facility, ids]) => [facility, new Set(ids)])),
})
const OPTIONS: DocumentTargetOptionsDto = {
  facilityId: 1,
  facilities: [
    { id: 1, name: 'Kita A', groups: [{ id: 11, name: 'Bären' }, { id: 12, name: 'Füchse' }] },
    { id: 2, name: 'Kita B', groups: [{ id: 21, name: 'Mäuse' }] },
    { id: 3, name: 'Kita C', groups: [] },
  ],
}

describe('„Gilt für“ (shared rules)', () => {
  it('shows an item in its facilities: all, the chosen ones, or the own one', () => {
    expect(inFacilityScope(targets(true, []), 9)).toBe(true)
    expect(inFacilityScope(targets(false, [[1, true]]), 1)).toBe(true)
    expect(inFacilityScope(targets(false, [[1, true]]), 2)).toBe(false)
    expect(scopeOf({ facilityId: 1 }, targets(false, [[1, true]]))).toBe('facility')
    expect(scopeOf({ facilityId: null }, targets(true, []))).toBe('all')
    expect(scopeOf({ facilityId: null }, targets(false, [[2, true]]))).toBe('selected')
  })

  it('lets groups limit an item per facility: the home group, or Leitung and Träger', () => {
    const limited = targets(true, [[1, false]], [[1, [11]], [2, [21]]])
    expect(groupsAllow(limited, 1, { role: 'observer', homeGroupId: 11 })).toBe(true)
    expect(groupsAllow(limited, 1, { role: 'observer', homeGroupId: 12 })).toBe(false)
    expect(groupsAllow(limited, 1, { role: 'observer', homeGroupId: null })).toBe(false)
    expect(groupsAllow(limited, 1, { role: 'terminal', homeGroupId: null })).toBe(false)
    expect(groupsAllow(limited, 1, { role: 'group_lead', homeGroupId: 12 })).toBe(false)
    // A helper whose group (of another facility) is chosen there: not here.
    expect(groupsAllow(limited, 1, { role: 'observer', homeGroupId: 21 })).toBe(false)
    expect(groupsAllow(limited, 1, { role: 'admin', homeGroupId: null })).toBe(true)
    expect(groupsAllow(limited, 1, { role: 'provider', homeGroupId: null })).toBe(true)
    // Facility 2 has no limiting row: all groups.
    expect(groupsAllow(limited, 2, { role: 'observer', homeGroupId: null })).toBe(true)
    // Limited, but no group left: managers only.
    const none = targets(false, [[1, false]])
    expect(reachesAudience(none, 1, { role: 'observer', homeGroupId: 11 })).toBe(false)
    expect(reachesAudience(none, 1, { role: 'admin', homeGroupId: null })).toBe(true)
  })

  it('names the facilities an item loses', () => {
    expect(facilitiesLosing('all', [1], [1, 2, 3])).toEqual([2, 3])
    expect(facilitiesLosing([1, 2], 'all', [1, 2, 3])).toEqual([])
    expect(facilitiesLosing([1, 2], [2], [])).toEqual([1])
  })

  it('searches regardless of case and umlaut spelling (ä/ae, ß/ss), every word', () => {
    expect(searchFold('Ärztliche STRASSE Straße')).toBe('aerztliche strasse strasse')
    // A decomposed umlaut (A + combining diaeresis), e.g. pasted from a PDF.
    expect(searchFold('Ärztin')).toBe('aerztin')
    expect(searchFold('Ärztin')).toBe('aerztin')
    expect(matchesSearch(['Ärztliches Attest', 'Gesundheit'], 'aerztl')).toBe(true)
    expect(matchesSearch(['Ärztliches Attest', 'Gesundheit'], 'ärztl gesund')).toBe(true)
    expect(matchesSearch(['Elternbrief'], 'eltern attest')).toBe(false)
    expect(matchesSearch(['x'], '  ')).toBe(true)
    expect(knowledgeMatches({ title: 'Fußweg', description: '', body: '<p>Übergänge</p>' }, 'fussweg uebergaenge')).toBe(true)
  })
})

describe('creating the category in the other facilities', () => {
  it('asks only for several or all facilities, naming the category path and the facilities', () => {
    expect([spansFacilities('all', []), spansFacilities('selected', [2, 3]), spansFacilities('selected', [2]), spansFacilities('facility', [1])])
      .toEqual([true, true, false, false])
    expect(de.categoryAdopt.question('Elternbriefe › Herbst', ['Kita A', 'Kita B']))
      .toBe('Die Kategorie ‚Elternbriefe › Herbst‘ gibt es in Kita A, Kita B noch nicht. Soll sie dort angelegt werden?')
  })
})

describe('„Gilt für“ in the form', () => {
  const dto = (overrides: Partial<DocumentTargetsDto>): DocumentTargetsDto => ({
    scope: 'facility', facilityIds: [1], facilityNames: [], groupTargets: [], groupNames: null, ...overrides,
  })

  it('starts with the own facility and all groups; copies an item\'s „Gilt für“', () => {
    expect(emptyTargets()).toEqual({ scope: 'facility', facilityIds: [], groupTargets: [] })
    expect(targetsFormOf(dto({ scope: 'selected', facilityIds: [2, 3], groupTargets: [{ facilityId: 2, groupIds: [21] }] })))
      .toEqual({ scope: 'selected', facilityIds: [2, 3], groupTargets: [{ facilityId: 2, groupIds: [21] }] })
    expect(targetsFormOf(dto({})).facilityIds).toEqual([])
  })

  it('knows an item whose chosen facilities are all gone (its dialog asks for one)', () => {
    expect(isOrphanTargets(dto({ scope: 'selected', facilityIds: [] }))).toBe(true)
    expect(isOrphanTargets(dto({ scope: 'selected', facilityIds: [2] }))).toBe(false)
    expect(isOrphanTargets(dto({ scope: 'all', facilityIds: [] }))).toBe(false)
    expect(isOrphanTargets(dto({}))).toBe(false)
    expect(isOrphanTargets(null)).toBe(false)
  })

  it('knows an item limited to groups that are all gone; both cases make the dialog check „Gilt für“ like a change', () => {
    const emptied = dto({ groupTargets: [{ facilityId: 1, groupIds: [] }], groupNames: [] })
    expect(hasEmptyGroupLimit(emptied)).toBe(true)
    expect(hasEmptyGroupLimit(dto({ groupTargets: [{ facilityId: 1, groupIds: [11] }] }))).toBe(false)
    expect(hasEmptyGroupLimit(null)).toBe(false)
    expect([emptied, dto({ scope: 'selected', facilityIds: [] }), dto({}), null].map(targetsNeedChoice)).toEqual([true, true, false, false])
    // The form asks for a group in that facility before saving.
    expect(targetsProblem(targetsFormOf(emptied), OPTIONS, 1)).toEqual({ kind: 'group', facility: 'Kita A' })
  })

  it('offers the groups of the facilities in the scope and edits the choice', () => {
    let form = emptyTargets()
    expect(facilitiesForGroups(OPTIONS, form, 1).map(facility => facility.id)).toEqual([1])
    form = { ...form, scope: 'all' }
    expect(facilitiesForGroups(OPTIONS, form, 1).map(facility => facility.id)).toEqual([1, 2, 3])
    form = toggleId(toggleId({ ...form, scope: 'selected' }, 2), 3)
    expect(form.facilityIds).toEqual([2, 3])
    form = toggleGroup(setGroupLimit(form, 2, true), 2, 21)
    expect(form.groupTargets).toEqual([{ facilityId: 2, groupIds: [21] }])
    // Taking a facility back drops its groups.
    expect(toggleId(form, 2)).toEqual({ scope: 'selected', facilityIds: [3], groupTargets: [] })
    expect(setGroupLimit(form, 2, false).groupTargets).toEqual([])
  })

  it('says what is missing and sends only the groups of facilities in the scope', () => {
    expect(targetsProblem({ scope: 'selected', facilityIds: [], groupTargets: [] }, OPTIONS, 1)).toEqual({ kind: 'facility' })
    expect(targetsProblem({ scope: 'facility', facilityIds: [], groupTargets: [{ facilityId: 1, groupIds: [] }] }, OPTIONS, 1))
      .toEqual({ kind: 'group', facility: 'Kita A' })
    expect(targetsProblem({ scope: 'facility', facilityIds: [], groupTargets: [{ facilityId: 2, groupIds: [] }] }, OPTIONS, 1)).toBeNull()
    expect(targetsPayload({ scope: 'facility', facilityIds: [2], groupTargets: [{ facilityId: 1, groupIds: [11] }, { facilityId: 2, groupIds: [21] }] }, OPTIONS, 1))
      .toEqual({ scope: 'facility', facilityIds: [], groupTargets: [{ facilityId: 1, groupIds: [11] }] })
  })

  it('drops nothing while the choices are not loaded (no options)', () => {
    const limited = { scope: 'facility' as const, facilityIds: [], groupTargets: [{ facilityId: 1, groupIds: [11] }] }
    expect(targetsPayload(limited, null, null).groupTargets).toEqual([{ facilityId: 1, groupIds: [11] }])
    expect(targetsPayload({ ...limited, scope: 'all' }, null, null).groupTargets).toEqual([{ facilityId: 1, groupIds: [11] }])
    expect(targetsProblem({ ...limited, groupTargets: [{ facilityId: 1, groupIds: [] }] }, null, null)).toEqual({ kind: 'group', facility: '' })
    expect(facilitiesForGroups(null, limited, 1)).toEqual([])
    expect(facilitiesLost(dto({ scope: 'all', facilityIds: [] }), limited, null, 1)).toBe(0)
  })

  it('counts the facilities that lose an item (to ask first)', () => {
    expect(facilitiesLost(dto({ scope: 'all', facilityIds: [] }), { scope: 'selected', facilityIds: [2], groupTargets: [] }, OPTIONS, 1)).toBe(2)
    expect(facilitiesLost(dto({ scope: 'selected', facilityIds: [2] }), { scope: 'all', facilityIds: [], groupTargets: [] }, OPTIONS, 1)).toBe(0)
    expect(facilitiesLost(dto({ scope: 'facility', facilityIds: [1] }), { scope: 'selected', facilityIds: [2], groupTargets: [] }, OPTIONS, 1)).toBe(1)
    expect(facilitiesLost(null, emptyTargets(), OPTIONS, 1)).toBe(0)
  })

  it('shows the hints for Leitung and Träger', () => {
    const texts = { only: (names: string[]) => `nur ${names.join(', ')}`, noGroup: 'keine Gruppe mehr gewählt', noFacility: 'Keine Einrichtung gewählt' }
    expect(targetHints(dto({ scope: 'selected', facilityNames: ['Kita A', 'Kita B'], groupNames: ['Bären', 'Füchse'] }), texts))
      .toEqual(['nur Kita A, Kita B', 'nur Bären, Füchse'])
    expect(targetHints(dto({ groupNames: [] }), texts)).toEqual(['keine Gruppe mehr gewählt'])
    expect(targetHints(dto({}), texts)).toEqual([])
    expect(targetHints(null, texts)).toEqual([])
    expect(targetHints(dto({ scope: 'selected', facilityIds: [], facilityNames: [] }), texts)).toEqual(['Keine Einrichtung gewählt'])
  })
})
