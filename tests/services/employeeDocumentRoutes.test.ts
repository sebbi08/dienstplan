import type { H3Event } from 'h3'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../../server/db/client'
import { uploadEmployeeDocument } from '../../server/services/employeeDocuments'
import { PAGE_FACILITY_HEADER } from '../../shared/domain/pageFacility'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb } from '../helpers/fixtures'

// The download route runs with Nitro's auto-imported helpers stubbed and the real guards of server/utils/auth.ts on a
// real test database (as in leaveCounting.test.ts).
let routeDb: Db
vi.stubGlobal('useDb', () => routeDb)
vi.stubGlobal('requireUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('getUserSession', async (event: FakeEvent) => event.session)
vi.stubGlobal('clearUserSession', async () => {})
vi.stubGlobal('setUserSession', async () => {})
vi.stubGlobal('getHeader', (event: FakeEvent, name: string) => event.headers[name.toLowerCase()])
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data: { code: string } }) =>
  Object.assign(new Error(input.statusMessage), input))
vi.stubGlobal('defineServiceHandler', (handler: (event: H3Event) => unknown) => handler)
vi.stubGlobal('getValidatedRouterParams', async (event: FakeEvent, parse: (value: unknown) => unknown) => parse(event.params))
vi.stubGlobal('getValidatedQuery', async (event: FakeEvent, parse: (value: unknown) => unknown) => parse(event.query))
vi.stubGlobal('setResponseHeaders', (event: FakeEvent, headers: Record<string, string>) => Object.assign(event.response, headers))

interface FakeEvent {
  headers: Record<string, string>
  context: Record<string, unknown>
  session: { user: { id: number }; loggedInAt: string }
  params: Record<string, string>
  query: Record<string, string>
  response: Record<string, string>
}
type Route = (event: H3Event) => Promise<Buffer>

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('Zeugnis')])

describe('GET /api/employee-documents/[id] (download of a personnel file document)', () => {
  let route: Route
  beforeAll(async () => {
    const auth = await import('../../server/utils/auth')
    vi.stubGlobal('requirePermission', (...args: Parameters<typeof auth.requirePermission>) => auth.requirePermission(...args))
    route = (await import('../../server/api/employee-documents/[id].get')).default as unknown as Route
  })

  let traeger: SessionUser
  let leitung: SessionUser
  let anna: number
  beforeEach(() => {
    routeDb = createTestDb()
    traeger = addUser(routeDb, 'traeger', 'provider')
    leitung = addUser(routeDb, 'leitung', 'admin')
    anna = addEmployee(routeDb, 'Anna Müller')
  })
  const upload = (folder: 'qualifications' | 'salary', title: string, employeeId = anna, facilityId = 1) =>
    uploadEmployeeDocument(routeDb, { ...traeger, facilityId }, facilityId, employeeId, {
      folder, title, documentDate: '2026-09-01', note: '',
    }, { data: pdf, filename: 'scan.pdf' })
  function event(user: SessionUser, id: number, query: Record<string, string> = {}): FakeEvent {
    return {
      headers: { [PAGE_FACILITY_HEADER.toLowerCase()]: '1' },
      context: {},
      session: { user: { id: user.id }, loggedInAt: new Date().toISOString() },
      params: { id: String(id) },
      query,
      response: {},
    }
  }
  async function code(run: () => Promise<unknown>): Promise<string | null> {
    try {
      await run()
      return null
    }
    catch (error) {
      const { code: own, data } = error as { code?: string; data?: { code?: string } }
      return data?.code ?? own ?? 'unknown'
    }
  }

  it('sends the bytes with the stored type, inline, a sanitised name, nosniff and no caching', async () => {
    const id = upload('qualifications', 'Zeugnis "Erste Hilfe"; ä/ö')
    const fake = event(leitung, id)
    const body = await route(fake as unknown as H3Event)
    expect(body.equals(pdf)).toBe(true)
    expect(body.length).toBe(pdf.length)
    expect(fake.response).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Anna-Mueller-Zeugnis-Erste-Hilfe-ae-oe-2026-09-01.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    const download = event(traeger, id, { download: '1' })
    await route(download as unknown as H3Event)
    expect(download.response['Content-Disposition']).toBe('attachment; filename="Anna-Mueller-Zeugnis-Erste-Hilfe-ae-oe-2026-09-01.pdf"')
  })

  it('refuses a folder without the key (403), another facility\'s document (404) and a Mitarbeiter (403)', async () => {
    const salary = upload('salary', 'Gehalt')
    expect(await code(() => route(event(leitung, salary) as unknown as H3Event))).toBe('forbidden')
    const hort = addFacility(routeDb, 'Hort')
    const other = upload('qualifications', 'Zeugnis', addEmployee(routeDb, 'Olga', { facilityId: hort }), hort)
    expect(await code(() => route(event(traeger, other) as unknown as H3Event))).toBe('document_not_found')
    const mitarbeiter = addUser(routeDb, 'ma', 'observer', addEmployee(routeDb, 'Mia'))
    expect(await code(() => route(event(mitarbeiter, salary) as unknown as H3Event))).toBe('forbidden')
  })
})
