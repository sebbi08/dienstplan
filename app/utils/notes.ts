import type { NotesDto, NoteVisibility } from '#shared/types/api'
import { de } from '~/locales/de'

/** The longest search the page sends (the server refuses a longer one). */
export const NOTE_SEARCH_MAX = 100

/**
 * Whether the reader may write any note at all: with the scope „ganze Einrichtung“, or for the own group (a group
 * writer without an own group has nothing to write).
 */
export const canCreateNote = (write: NotesDto['write']): boolean => write !== null && (write.facility || write.groupId !== null)

/** The search from the page's query (`?q=…`) as typed, at most NOTE_SEARCH_MAX chars; anything else is no search. */
export const noteSearchFromQuery = (value: unknown): string => (typeof value === 'string' ? value.slice(0, NOTE_SEARCH_MAX) : '')

/** The choices „Sichtbar für“ of the form: exactly the levels the writer may choose (`write.visibilities`), labelled. */
export const noteVisibilityItems = (visibilities: readonly NoteVisibility[]): { label: string; value: NoteVisibility }[] =>
  visibilities.map(value => ({ label: de.notes.visibilities[value], value }))

/** The badge of a note visible only to Leitung and Träger or only to the Träger; null for one visible to all. */
export const noteVisibilityBadge = (visibility: NoteVisibility): string | null =>
  (visibility === 'all' ? null : de.notes.visibilities[visibility])
