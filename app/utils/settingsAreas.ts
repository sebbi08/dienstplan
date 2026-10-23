// The label texts are imported relative so a test can load this file.
import { de } from '../locales/de'

/**
 * The settings, split into areas with their own pages (/admin/settings/<area>), plus the page of one group
 * (/admin/settings/groups/<id>). Every former section of the single settings page lives in exactly one place here;
 * the opening hours and the reminders were split into the facility's part and each group's part. Only Leitung and Träger
 * reach the settings at all; sections marked `providerOnly` are for the Träger alone (as before). The server checks
 * every request as well.
 */

export const SETTINGS_AREAS = ['facility', 'groups', 'roster', 'time', 'children', 'staff'] as const
export type SettingsArea = typeof SETTINGS_AREAS[number]

/** The address of each area below /admin/settings. */
export const AREA_SLUGS: Record<SettingsArea, string> = {
  facility: 'facility', groups: 'groups', roster: 'roster', time: 'time-tracking', children: 'children', staff: 'staff',
}

/** The sections of the single settings page as they were before the split (two of them are now split in two). */
export const FORMER_SECTIONS = [
  'time-tracking', 'shift-templates', 'week-templates', 'leave-module', 'facilities', 'codes', 'coverage-rules',
  'opening-hours', 'opening-hours-groups', 'requirement-types', 'care-types', 'document-types', 'school-children', 'tablet',
  'group-books', 'group-capacity', 'group-types', 'group-colors', 'staffing', 'attendance', 'reminders', 'reminders-group-doc',
  'retention', 'backup',
] as const
export type FormerSection = typeof FORMER_SECTIONS[number]

export interface SettingsSection {
  key: string
  title: string
  /** Further words the search finds the section by (lower or upper case does not matter). */
  keywords: readonly string[]
  /** Only the Träger sees it. */
  providerOnly?: boolean
  /** The parts of the former single page shown here. */
  replaces: readonly FormerSection[]
}

const s = de.settingsAreas

/** The sections of each area, in their order on the page. */
export const AREA_SECTIONS: Record<SettingsArea, readonly SettingsSection[]> = {
  facility: [
    {
      key: 'facilities', title: de.facilities.title, providerOnly: true, replaces: ['facilities'],
      keywords: ['Träger', 'Bundesland', 'Feiertage', 'Höchstzahl Einrichtung', 'Betriebserlaubnis', 'Gruppe anlegen', 'Gruppe umbenennen', 'Gruppe löschen', 'Hort', 'Mariä Himmelfahrt'],
    },
    {
      key: 'facility-hours', title: s.facilityHours, replaces: ['opening-hours'],
      keywords: ['Öffnungszeiten', 'Öffnung', 'Schließung', 'geöffnet', 'geschlossen', 'Mindestens zur Öffnung', 'Frühdienst', 'Spätdienst'],
    },
    {
      key: 'tablet', title: de.tablet.title, replaces: ['tablet'],
      keywords: ['PIN', 'Sperrzeit', 'sperren', 'Vormerkungen', 'Warteliste', 'künftige Kinder', 'Terminal'],
    },
    {
      key: 'retention', title: de.childSettings.retention, providerOnly: true, replaces: ['retention'],
      keywords: ['Löschfrist', 'löschen', 'Datenschutz', 'Aufbewahrung', 'abgemeldete Kinder', 'Archiv'],
    },
    {
      key: 'backup', title: de.settings.backup, providerOnly: true, replaces: ['backup'],
      keywords: ['Backup', 'Datenbank', 'herunterladen', 'Sicherung', 'Kopie'],
    },
  ],
  groups: [
    {
      key: 'group-list', title: s.groupList, replaces: [],
      keywords: ['Gruppe', 'Gruppen', 'Reihenfolge', 'sortieren'],
    },
  ],
  roster: [
    {
      key: 'shift-templates', title: de.settings.templates, replaces: ['shift-templates'],
      keywords: ['Dienst', 'Dienste', 'Schicht', 'Kürzel', 'Pause', 'ArbZG', 'Arbeitszeit', 'Betreuungskraft', 'VZ', 'Büro'],
    },
    {
      key: 'week-templates', title: de.weekTemplates.title, replaces: ['week-templates'],
      keywords: ['Vorlage', 'Woche', 'Wochenplan', 'Planwoche'],
    },
    {
      key: 'codes', title: de.settings.codes, replaces: ['codes'],
      keywords: ['Abwesenheit', 'Urlaub', 'Krank', 'Anrechnung', 'Tagessoll', 'Code'],
    },
    {
      key: 'coverage-rules', title: de.settings.rules, replaces: ['coverage-rules'],
      keywords: ['Mindestanzahl', 'Mindestbesetzung', 'Besetzung', 'Warnung', 'Pflichtdienst'],
    },
    {
      key: 'requirement-types', title: de.requirements.kinds, replaces: ['requirement-types'],
      keywords: ['Fortbildung', 'Erste Hilfe', 'Belehrung', 'Termin', 'Pflichttermin'],
    },
    {
      key: 'leave-module', title: de.leavePlanning.module, providerOnly: true, replaces: ['leave-module'],
      keywords: ['Urlaub', 'Urlaubsantrag', 'Urlaubsplanung', 'Antrag', 'Urlaub beantragen'],
    },
  ],
  time: [
    {
      key: 'time-tracking', title: de.settings.timeTracking, replaces: ['time-tracking'],
      keywords: ['Stempeln', 'Stempel', 'Kulanz', 'zu spät', 'früher gehen', 'Zeiterfassung ab'],
    },
  ],
  children: [
    {
      key: 'care-types', title: de.childSettings.careTypes, replaces: ['care-types'],
      keywords: ['Betreuungszeit', 'Zeitfenster', 'Tage pro Woche', 'Buchungszeit', 'Betreuungsform'],
    },
    {
      key: 'document-types', title: de.childSettings.documentTypes, replaces: ['document-types'],
      keywords: ['Dokument', 'Dokumente', 'Betreuungsvertrag', 'vertraulich', 'Unterlagen'],
    },
    {
      key: 'school-children', title: de.schoolChildren.title, replaces: ['school-children'],
      keywords: ['Stichtag', 'Einschulung', 'Schulstart', 'Schule', 'automatisch abmelden', 'Hort'],
    },
    {
      key: 'attendance', title: s.attendance, replaces: ['attendance'],
      keywords: ['Anwesenheit', 'Essen', 'Mittagessen', 'Snack', 'Frühstück', 'Vesper', 'Mahlzeit', 'Bringperson', 'Anwesenheit erfasst ab'],
    },
    {
      key: 'reminders', title: de.reminders.settings.title, replaces: ['reminders'],
      keywords: ['Erinnerung', 'Geburtstag', 'Abschied', 'Austritt', 'Vorlauf', 'Entwicklungsdokumentation', 'Kinder ohne Gruppe'],
    },
  ],
  staff: [
    {
      key: 'staffing', title: de.staffing.tab, replaces: ['staffing'],
      keywords: ['Personal', 'Fachkraft', 'Betreuungsschlüssel', 'Schlüssel', 'Mindestpersonal', 'Bundesland'],
    },
  ],
}

/** The sections of a group's page, in their order there (a group without the state's group types has no Gruppenart). */
export const GROUP_SECTIONS: readonly SettingsSection[] = [
  { key: 'group-name', title: s.groupName, replaces: [], keywords: ['Name', 'umbenennen', 'Reihenfolge', 'Hort', 'Schulkinder'] },
  { key: 'group-color', title: de.groups.colorsTitle, replaces: ['group-colors'], keywords: ['Farbe', 'Farben', 'Jahreskalender', 'Urlaubsplanung'] },
  {
    key: 'group-capacity', title: de.capacity.groupsTitle, replaces: ['group-capacity'],
    keywords: ['Höchstzahl', 'Plätze', 'Kinderzahl', 'Belegung', 'Kapazität'],
  },
  { key: 'group-type', title: de.staffing.groupTypesTitle, replaces: ['group-types'], keywords: ['Gruppenart', 'Gruppentyp', 'Krippe', 'Personalschlüssel'] },
  {
    key: 'group-hours', title: de.openingHours.groupOwn, replaces: ['opening-hours-groups'],
    keywords: ['Öffnungszeiten', 'Öffnung', 'Schließung', 'eigene Zeiten'],
  },
  {
    key: 'group-documentation', title: s.groupDocumentation, replaces: ['reminders-group-doc'],
    keywords: ['Entwicklungsdokumentation', 'Entwicklungsdoku', 'Doku', 'Beobachtung', 'Erinnerung'],
  },
  {
    key: 'group-read-access', title: s.groupReadAccess, replaces: ['group-books'],
    keywords: ['Gruppenbücher', 'Gruppenbuch', 'lesen', 'Freischaltung', 'Tablet'],
  },
]

/** Who looks at the settings: the Träger or the Leitung. */
export interface SettingsViewer { isProvider: boolean }

const sectionVisible = (section: SettingsSection, viewer: SettingsViewer) => !section.providerOnly || viewer.isProvider

export interface VisibleArea {
  area: SettingsArea; title: string; path: string; sections: SettingsSection[]
  /** What is in it, for the overview: the section names (for the groups: what a group's page holds). */
  summary: string
}

export const areaPath = (area: SettingsArea) => `/admin/settings/${AREA_SLUGS[area]}`
export const groupPath = (groupId: number) => `/admin/settings/groups/${groupId}`
/** The element id of a section on its page (the search scrolls there). */
export const sectionAnchor = (key: string) => `section-${key}`

/** The areas with the sections this viewer may see; an area without one is left out. */
export function visibleSettingsAreas(viewer: SettingsViewer): VisibleArea[] {
  return SETTINGS_AREAS
    .map((area) => {
      const sections = AREA_SECTIONS[area].filter(section => sectionVisible(section, viewer))
      const summary = area === 'groups' ? s.groupsSummary : sections.map(section => section.title).join(', ')
      return { area, title: s.areas[area], path: areaPath(area), sections, summary }
    })
    .filter(entry => entry.sections.length > 0)
}

/** The area of an address part (`roster`, `time-tracking` …), null when unknown. */
export function areaOfSlug(slug: unknown): SettingsArea | null {
  return SETTINGS_AREAS.find(area => AREA_SLUGS[area] === slug) ?? null
}

/** Lower case without accents (ä → a, ß → ss), so „schliessung“ finds „Schließung“. */
export function normalizeSearch(text: string): string {
  return text.toLocaleLowerCase('de-DE').replaceAll('ß', 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export interface SettingsHit {
  key: string
  title: string
  /** Where it is, e.g. „Kinder“ or „Gruppen · je Gruppe“. */
  where: string
  /** The address to open, with the section's anchor. */
  to: string
}

/** What the search needs to know about the active facility. */
export interface SettingsSearchContext {
  /** Its groups (none: the sections of a group's page are not offered). */
  groups?: readonly { id: number; name: string }[]
  /** The state's rules know group types (otherwise there is no Gruppenart to find). */
  hasGroupTypes?: boolean
}

/**
 * The sections whose name or keywords contain the typed text (best first: the name starting with it, the name
 * containing it, a keyword). The sections of a group's page lead to the list of groups (only when the facility has
 * groups; the Gruppenart only where the state has group types); a group's name leads to its page. Nothing for less
 * than two letters.
 */
export function searchSettings(query: string, viewer: SettingsViewer, context: SettingsSearchContext = {}): SettingsHit[] {
  const groups = context.groups ?? []
  const needle = normalizeSearch(query)
  if (needle.length < 2) return []
  const rank = (section: Pick<SettingsSection, 'title' | 'keywords'>): number | null => {
    const title = normalizeSearch(section.title)
    if (title.startsWith(needle)) return 0
    if (title.includes(needle)) return 1
    return section.keywords.some(word => normalizeSearch(word).includes(needle)) ? 2 : null
  }
  const hits: { hit: SettingsHit; rank: number; order: number }[] = []
  const add = (hit: SettingsHit, value: number | null) => {
    if (value !== null) hits.push({ hit, rank: value, order: hits.length })
  }
  for (const entry of visibleSettingsAreas(viewer)) {
    for (const section of entry.sections) {
      add({ key: section.key, title: section.title, where: entry.title, to: `${entry.path}#${sectionAnchor(section.key)}` }, rank(section))
    }
  }
  const groupsTitle = s.areas.groups
  const groupSections = groups.length === 0 ? [] : GROUP_SECTIONS.filter(section => section.key !== 'group-type' || context.hasGroupTypes)
  for (const section of groupSections) {
    add({
      key: section.key, title: section.title, where: `${groupsTitle} · ${s.perGroup}`,
      to: `${areaPath('groups')}#${sectionAnchor('group-list')}`,
    }, rank(section))
  }
  for (const group of groups) {
    add({ key: `group-${group.id}`, title: group.name, where: `${groupsTitle} · ${s.groupHit}`, to: groupPath(group.id) }, rank({ title: group.name, keywords: [] }))
  }
  return hits.sort((a, b) => a.rank - b.rank || a.order - b.order).map(entry => entry.hit)
}
