import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AREA_TABS, CHILDREN_TABS, areaOfTab, defaultChildrenTab, readChildrenTabMemory, requestedChildrenTab, tabForArea,
  visibleChildrenAreas, writeChildrenTabMemory, type ChildrenViewer,
} from '../../app/utils/childrenAreas'

const staffAtTablet: ChildrenViewer = { isManager: false, onTablet: true, showPlanned: false }
const staffAtTabletPlanned: ChildrenViewer = { isManager: false, onTablet: true, showPlanned: true }
const leaderAtTablet: ChildrenViewer = { isManager: true, onTablet: true, showPlanned: true }
const providerInOffice: ChildrenViewer = { isManager: true, onTablet: false, showPlanned: true }

const areas = (viewer: ChildrenViewer) => visibleChildrenAreas(viewer).map(entry => [entry.area, entry.tabs])

describe('visibleChildrenAreas', () => {
  it('shows staff at the tablet only Heute and Kinder', () => {
    expect(areas(staffAtTablet)).toEqual([
      ['today', ['attendance', 'week']],
      ['children', ['list', 'overview', 'birthdays', 'documents', 'open']],
    ])
  })

  it('never shows staff the Planung, even with the planned children switched on', () => {
    expect(areas(staffAtTabletPlanned).map(([area]) => area)).toEqual(['today', 'children'])
  })

  it('adds the Planung for the Leitung at the tablet, without the Personalschlüssel', () => {
    expect(areas(leaderAtTablet)).toEqual([
      ['today', ['attendance', 'week']],
      ['children', ['list', 'overview', 'birthdays', 'documents', 'open']],
      ['planning', ['planned', 'occupancy', 'archive']],
    ])
  })

  it('shows the Träger in the office every sub-tab', () => {
    expect(visibleChildrenAreas(providerInOffice).flatMap(entry => entry.tabs)).toEqual([
      'attendance', 'week', 'list', 'overview', 'birthdays', 'documents', 'open', 'planned', 'occupancy', 'staffing', 'archive',
    ])
  })

  it('keeps the planned children behind the switches for a manager as well', () => {
    expect(areas({ ...leaderAtTablet, showPlanned: false })).toContainEqual(['planning', ['occupancy', 'archive']])
  })

  it('hides an area without a visible sub-tab', () => {
    expect(areas(staffAtTablet).some(([area]) => area === 'planning')).toBe(false)
  })

  it('puts every tab into exactly one area', () => {
    const all = Object.values(AREA_TABS).flat()
    expect([...all].sort()).toEqual([...CHILDREN_TABS].sort())
  })
})

describe('old tab keys and the default', () => {
  it('maps the old tab keys to their area', () => {
    expect(areaOfTab('attendance')).toBe('today')
    expect(areaOfTab('week')).toBe('today')
    expect(areaOfTab('list')).toBe('children')
    expect(areaOfTab('overview')).toBe('children')
    expect(areaOfTab('birthdays')).toBe('children')
    expect(areaOfTab('documents')).toBe('children')
    expect(areaOfTab('open')).toBe('children')
    expect(areaOfTab('planned')).toBe('planning')
    expect(areaOfTab('occupancy')).toBe('planning')
    expect(areaOfTab('staffing')).toBe('planning')
    expect(areaOfTab('archive')).toBe('planning')
  })

  it('opens an old tab key as that sub-tab when it is visible', () => {
    expect(requestedChildrenTab('occupancy', providerInOffice)).toBe('occupancy')
    expect(requestedChildrenTab('birthdays', staffAtTablet)).toBe('birthdays')
  })

  it('opens an area key with its first visible sub-tab', () => {
    expect(requestedChildrenTab('planning', providerInOffice)).toBe('planned')
    expect(requestedChildrenTab('planning', { ...leaderAtTablet, showPlanned: false })).toBe('occupancy')
    expect(requestedChildrenTab('children', staffAtTablet)).toBe('list')
  })

  it('ignores unknown keys and sub-tabs the viewer may not see', () => {
    expect(requestedChildrenTab('archive', staffAtTablet)).toBeNull()
    expect(requestedChildrenTab('staffing', leaderAtTablet)).toBeNull()
    expect(requestedChildrenTab('planning', staffAtTablet)).toBeNull()
    expect(requestedChildrenTab('nothing', providerInOffice)).toBeNull()
    expect(requestedChildrenTab(['list'], providerInOffice)).toBeNull()
    expect(requestedChildrenTab(undefined, providerInOffice)).toBeNull()
  })

  it('opens with Heute → Anwesenheit', () => {
    expect(defaultChildrenTab(staffAtTablet)).toBe('attendance')
    expect(defaultChildrenTab(providerInOffice)).toBe('attendance')
  })

  it('returns to the sub-tab last used in an area while it is visible', () => {
    expect(tabForArea('children', staffAtTablet, { children: 'documents' })).toBe('documents')
    expect(tabForArea('planning', leaderAtTablet, { planning: 'staffing' })).toBe('planned')
    expect(tabForArea('planning', staffAtTablet, { planning: 'archive' })).toBeNull()
    // A sub-tab of another area is no memory of this one.
    expect(tabForArea('today', staffAtTablet, { today: 'list' })).toBe('attendance')
  })
})

describe('children tab memory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the sub-tab and the last one per area', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(readChildrenTabMemory()).toEqual({ tab: null, last: {} })
    writeChildrenTabMemory({ tab: 'occupancy', last: { children: 'birthdays', planning: 'occupancy' } })
    expect(readChildrenTabMemory()).toEqual({ tab: 'occupancy', last: { children: 'birthdays', planning: 'occupancy' } })
  })

  it('drops what it cannot read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ tab: 'gone', last: { children: 'archive', planning: 'occupancy', nowhere: 'list' } }),
      setItem: () => {}, removeItem: () => {},
    })
    expect(readChildrenTabMemory()).toEqual({ tab: null, last: { planning: 'occupancy' } })
    vi.stubGlobal('localStorage', { getItem: () => '{"tab":', setItem: () => {}, removeItem: () => {} })
    expect(readChildrenTabMemory()).toEqual({ tab: null, last: {} })
  })

  it('works without storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readChildrenTabMemory()).toEqual({ tab: null, last: {} })
    expect(() => writeChildrenTabMemory({ tab: 'list', last: {} })).not.toThrow()
  })
})
