import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { RECORD_SECTIONS, currentRecordSection, recordScrollTarget, recordSectionId } from '../../app/utils/recordJump'

describe('the jump bar of the child record', () => {
  it('lists the sections in page order, each with a short label and an id of its own', () => {
    expect(RECORD_SECTIONS).toEqual([
      'master', 'contacts', 'health', 'notes', 'consents', 'documents', 'development', 'meetings', 'forms', 'accidents', 'lifecycle',
    ])
    expect(RECORD_SECTIONS.map(key => de.children.jump.sections[key])).toEqual([
      'Stammdaten', 'Bezugspersonen', 'Gesundheit', 'Notizen', 'Einwilligungen', 'Dokumente', 'Entwicklung', 'Elterngespräche',
      'Beobachtungen', 'Unfälle', 'Abmeldung',
    ])
    expect(new Set(RECORD_SECTIONS.map(recordSectionId)).size).toBe(RECORD_SECTIONS.length)
    expect(recordSectionId('accidents')).toBe('akte-accidents')
  })

  it('highlights the last section whose start passed the line below the bars, else the first', () => {
    const tops = [{ key: 'master' as const, top: -400 }, { key: 'contacts' as const, top: 90 }, { key: 'health' as const, top: 700 }]
    expect(currentRecordSection(tops, 120)).toBe('contacts')
    expect(currentRecordSection(tops, 80)).toBe('master')
    expect(currentRecordSection([{ key: 'master', top: 300 }, { key: 'health', top: 900 }], 120)).toBe('master')
    expect(currentRecordSection([], 120)).toBeNull()
  })

  it('at the end of the page: the section jumped to while in view, else the last one', () => {
    const tops = [{ key: 'forms' as const, top: 200 }, { key: 'accidents' as const, top: 500 }, { key: 'lifecycle' as const, top: 650 }]
    expect(currentRecordSection(tops, 120, { atBottom: true })).toBe('lifecycle')
    expect(currentRecordSection(tops, 120, { atBottom: true, preferred: 'accidents', viewportHeight: 800 })).toBe('accidents')
    // Out of view (or not shown at all): the last one.
    expect(currentRecordSection(tops, 120, { atBottom: true, preferred: 'accidents', viewportHeight: 400 })).toBe('lifecycle')
    expect(currentRecordSection(tops, 120, { atBottom: true, preferred: 'notes', viewportHeight: 800 })).toBe('lifecycle')
  })

  it('scrolls a section to just below the header and the bar; on phones going down only below the bar', () => {
    // The section starts 1000 px below the window's top, the page is scrolled by 200.
    expect(recordScrollTarget(1000, 200, { header: 60, bar: 52, headerHides: false })).toBe(1080)
    expect(recordScrollTarget(1000, 200, { header: 60, bar: 52, headerHides: true })).toBe(1140)
    // Going up the header comes back on phones as well.
    expect(recordScrollTarget(-500, 2000, { header: 60, bar: 52, headerHides: true })).toBe(1380)
    // Near the top the header stays (it only slides away beyond 64 px).
    expect(recordScrollTarget(150, 0, { header: 60, bar: 52, headerHides: true })).toBe(30)
    expect(recordScrollTarget(20, 0, { header: 60, bar: 52, headerHides: false })).toBe(0)
  })
})
