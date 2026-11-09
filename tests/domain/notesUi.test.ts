import { describe, expect, it } from 'vitest'
import { canCreateNote, noteDayHeading, notesByDay } from '../../app/utils/notes'
import type { NoteDto } from '../../shared/types/api'

const note = (id: number, date: string | null): NoteDto => ({
  id, kind: date === null ? 'board' : 'day', groupId: null, groupName: null, date, validUntil: null, text: `Notiz ${id}`,
  createdAt: '2026-11-09T08:00:00.000Z', createdBy: 'Anna', updatedAt: null, updatedBy: null, canEdit: false,
})

describe('notesByDay', () => {
  it('groups the day notes by day in the given order', () => {
    const days = notesByDay([note(1, '2026-11-09'), note(2, '2026-11-09'), note(3, '2026-11-12'), note(4, null)])
    expect(days.map(day => [day.date, day.notes.map(entry => entry.id)])).toEqual([['2026-11-09', [1, 2]], ['2026-11-12', [3]]])
    // The earlier days come newest first: the order stays as the server sends it.
    expect(notesByDay([note(5, '2026-11-02'), note(6, '2026-10-30')]).map(day => day.date)).toEqual(['2026-11-02', '2026-10-30'])
  })
})

describe('noteDayHeading', () => {
  it('names the weekday and the date, „Heute“ for today', () => {
    expect(noteDayHeading('2026-11-10', '2026-11-09')).toBe('Dienstag, 10.11.2026')
    expect(noteDayHeading('2026-11-09', '2026-11-09')).toBe('Heute, 09.11.2026')
  })
})

describe('canCreateNote', () => {
  it('needs the whole facility or an own group', () => {
    expect(canCreateNote(null)).toBe(false)
    expect(canCreateNote({ facility: true, groupId: null })).toBe(true)
    expect(canCreateNote({ facility: false, groupId: 3 })).toBe(true)
    expect(canCreateNote({ facility: false, groupId: null })).toBe(false)
  })
})
