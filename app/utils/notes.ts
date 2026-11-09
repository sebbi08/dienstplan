import type { IsoDate } from '#shared/domain/types'
import type { NoteDto, NotesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/** The day notes by day, in the order given (the server sorts them), each day once. */
export function notesByDay(notes: readonly NoteDto[]): { date: IsoDate; notes: NoteDto[] }[] {
  const days: { date: IsoDate; notes: NoteDto[] }[] = []
  for (const note of notes) {
    if (note.date === null) continue
    const last = days.at(-1)
    if (last?.date === note.date) last.notes.push(note)
    else days.push({ date: note.date, notes: [note] })
  }
  return days
}

const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' })

/** The heading of a day: „Heute, 09.11.2026“ for today, else „Dienstag, 10.11.2026“. */
export function noteDayHeading(date: IsoDate, today: IsoDate): string {
  const day = date === today ? de.notes.today : weekdayFormat.format(new Date(`${date}T00:00:00Z`))
  return `${day}, ${formatDate(date)}`
}

/**
 * Whether the reader may write any note at all: with the scope „ganze Einrichtung“, or for the own group (a group
 * writer without an own group has nothing to write).
 */
export const canCreateNote = (write: NotesDto['write']): boolean => write !== null && (write.facility || write.groupId !== null)
