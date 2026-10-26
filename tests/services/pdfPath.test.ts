import { describe, expect, it } from 'vitest'
import { PDF_PATH } from '../../server/utils/pdf'

describe('PDF_PATH (print views that may be rendered as PDF)', () => {
  it.each([
    '/print/2026/10',
    '/print/2026/10?group=3',
    '/print/2026/10?group=123',
    '/admin/print/calendar/2026',
    '/admin/print/calendar/2026?group=4',
    '/admin/print/calendar/2026?group=none',
    '/admin/print/time/4/2026/10',
    '/admin/print/forms/12',
    '/print/my-forms/12',
    '/print/team-meetings/12',
  ])('accepts %s', (path) => {
    expect(PDF_PATH.test(path)).toBe(true)
  })

  it.each([
    '/print/2026/10?group=3&x',
    '/print/2026/10?group=3&group=4',
    '/print/2026/10?group=',
    '/print/2026/10?group=a',
    '/admin/print/calendar/2026?group=nonex',
    '/admin/print/calendar/2026?group=none3',
    '/print/2026/10?x=1',
    '/print/2026/10?Group=3',
    '/print/2026/10#a',
    '/print/2026/10\n',
    '/print/2026/10?group=3\n',
    '/print/2026/10%3Fgroup=3',
    '/print/../x',
    '/print/2026/10/../../admin',
    '/plan/2026/10',
    '/api/print/2026/10',
    'print/2026/10',
  ])('rejects %j', (path) => {
    expect(PDF_PATH.test(path)).toBe(false)
  })
})
