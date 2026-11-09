import type { NotesDto } from '#shared/types/api'

/** The longest search the page sends (the server refuses a longer one). */
export const NOTE_SEARCH_MAX = 100

/**
 * Whether the reader may write any note at all: with the scope „ganze Einrichtung“, or for the own group (a group
 * writer without an own group has nothing to write).
 */
export const canCreateNote = (write: NotesDto['write']): boolean => write !== null && (write.facility || write.groupId !== null)

/** The search from the page's query (`?q=…`) as typed, at most NOTE_SEARCH_MAX chars; anything else is no search. */
export const noteSearchFromQuery = (value: unknown): string => (typeof value === 'string' ? value.slice(0, NOTE_SEARCH_MAX) : '')
