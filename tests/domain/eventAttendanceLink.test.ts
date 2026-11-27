import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attendanceIdOf, attendanceLink } from '../../app/utils/eventRequirements'

const page = readFileSync('app/pages/admin/calendar/index.vue', 'utf8')

describe('„Teilnahme bestätigen“ by link (?attendance=)', () => {
  it('reads the appointment of the link „Offen für dich“ gives, and nothing else', () => {
    const query = new URL(attendanceLink({ eventId: 42, year: 2026 }), 'http://x').searchParams
    expect(attendanceIdOf(query.get('attendance'))).toBe(42)
    expect(query.get('year')).toBe('2026')
    for (const value of [undefined, null, '', '0', '-3', '4.5', 'abc', '12abc', ['7'], 7, '99999999999999999999']) {
      expect(attendanceIdOf(value), String(value)).toBeNull()
    }
  })

  it('is watched by the year calendar, so a link followed on the page itself opens the dialog (M9)', () => {
    expect(page).toMatch(/watch\(\(\) => route\.query\.attendance,[\s\S]*?attendanceIdOf\(value\)[\s\S]*?\{ immediate: true \}\)/)
    expect(page).not.toMatch(/Number\(route\.query\.attendance\)/)
  })

  it('shows the Terminliste\'s delete button only where deleting is allowed (M6)', () => {
    expect(page).toMatch(/const deletable = \(event: CalendarEventDto\) => mayChangeEvent\(!!event\.requirement, canTab\('employees\.edit'\)\)/)
    expect(page).toMatch(/v-if="deletable\(event\)"[^>]*icon="i-lucide-trash-2"/)
  })
})
