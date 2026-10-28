// Freezes who passes the guard of every API route today (Rechte und Rollen, Teil 1, Task 1), so the switch to
// permission checks can be proven to change nothing. Reads the guards each file under server/api calls and writes
// tests/fixtures/route-access-before.json: { "<route file relative to server/api>": [actors that get in] }.
//
//   node scripts/route-access-snapshot.mjs          writes the fixture
//   node scripts/route-access-snapshot.mjs --check  exits 1 if the fixture differs from today's guards
//
// Actors (fixed order):
//   anonymous            no session
//   provider/admin/observer  the own account (Träger / Leitung / Mitarbeiter), with a facility
//   terminal             the tablet session, locked or unlocked (the guard does not look at the unlock)
//   tablet:<person>      the tablet session unlocked by that person; only named where a child guard reads the unlock:
//                        tablet:provider / tablet:admin (account of that role), tablet:observerEditor (Mitarbeiter
//                        account with „darf Kinderakten pflegen“), tablet:observer (Mitarbeiter account without it),
//                        tablet:noAccount (person without an account, or a helper from another facility)
// Guard-level only: rules inside the services (planner, own employee, group rights, contract fields …) are not part of
// it. A route with several guards gets the intersection (the strictest combination).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// Node strips the types of the shared catalog and bundles (no build step, Node 22.18+ / 23.6+). This relies on
// permissions.ts and permissionBundles.ts staying strippable: runtime imports between them with the `.ts` extension,
// only `import type` from other modules, and no TS-only syntax that emits code (enum, namespace, parameter properties).
// tests/api/routeAccessSnapshot.test.ts fails when it breaks.
import { effectivePermissions } from '../shared/domain/permissionBundles.ts'
import { PERMISSION_KEYS } from '../shared/domain/permissions.ts'

// The Grundeinstellung of the rights page (no role settings, no exceptions).
const DEFAULTS = {
  admin: effectivePermissions({ role: 'admin' }),
  observer: effectivePermissions({ role: 'observer' }),
}
// A Mitarbeiter account with the exception „eintragen und Akten ändern“ (formerly „darf Kinderakten pflegen“), and the
// child keys that need an account (server/lib/childViewer.ts).
const OBSERVER_EDITOR = effectivePermissions({
  role: 'observer', overrides: [{ bundle: 'childrenEdit', effect: 'grant', scope: 'group' }],
})
const ACCOUNT_KEYS = ['children.edit', 'children.manage']

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = join(ROOT, 'server', 'api')
const OUT = join(ROOT, 'tests', 'fixtures', 'route-access-before.json')

export const ACTORS = ['anonymous', 'provider', 'admin', 'observer', 'terminal', 'tablet:provider', 'tablet:admin',
  'tablet:observerEditor', 'tablet:observer', 'tablet:noAccount']

const TABLET_READERS = ['tablet:provider', 'tablet:admin', 'tablet:observerEditor', 'tablet:observer', 'tablet:noAccount']

/** Who passes each guard of server/utils/auth.ts (inventory §1); null = no role restriction of its own. */
const GUARDS = {
  requireProvider: () => ['provider'],
  requireAdmin: () => ['provider', 'admin'],
  requireUser: args => /allowTerminal:\s*true/.test(args)
    ? ['provider', 'admin', 'observer', 'terminal']
    : ['provider', 'admin', 'observer'],
  requireTerminal: () => ['terminal'],
  // templateReaderFacility: managers and the tablet without unlock; a Mitarbeiter account gets 403.
  requireTemplateReader: () => ['provider', 'admin', 'terminal'],
  // resolveChildViewer: managers with the own account (a Mitarbeiter account gets 403 children_tablet_only), or
  // whoever unlocked the tablet (a locked tablet gets 403 tablet_locked).
  requireChildReader: () => ['provider', 'admin', ...TABLET_READERS],
  // asChildEditor: mayEditChildren and an account (id !== null).
  requireChildEditor: () => ['provider', 'admin', 'tablet:provider', 'tablet:admin', 'tablet:observerEditor'],
  // asChildManager: isManager and an account.
  requireChildManager: () => ['provider', 'admin', 'tablet:provider', 'tablet:admin'],
  // Only a facility (403 no_facility) and the page checks; always after one of the guards above.
  requireFacility: () => null,
  // Since Teil 1 Task 2: the Träger (every key), Leitung and Mitarbeiter by their role defaults without per-person
  // flags, the tablet only with allowTerminal. --check thereby proves the switch kept who gets in.
  requirePermission: (args) => {
    const key = /^\s*event,\s*'([^']+)'/.exec(args)?.[1]
    if (!PERMISSION_KEYS.includes(key)) throw new Error(`unknown permission in requirePermission(${args})`)
    return ['provider', 'admin', 'observer', 'terminal'].filter(actor => actor === 'provider'
      || (actor === 'terminal' ? /allowTerminal:\s*true/.test(args) : DEFAULTS[actor].has(key)))
  },
  // Since Teil 1 Task 3: the own account needs children.ownAccount besides the key; the tablet only unlocked, with the
  // unlocking person's permissions (the Mitarbeiter defaults for a person without account, who never gets the keys
  // that change records, children.edit and children.manage: no account to record as "changed by").
  requireChildPermission: (args) => {
    const key = /^\s*event,\s*'([^']+)'\s*$/.exec(args)?.[1]
    if (!PERMISSION_KEYS.includes(key)) throw new Error(`unknown permission in requireChildPermission(${args})`)
    const office = actor => actor === 'provider' || (DEFAULTS[actor].has('children.ownAccount') && DEFAULTS[actor].has(key))
    const tablet = {
      'tablet:provider': true,
      'tablet:admin': DEFAULTS.admin.has(key),
      'tablet:observerEditor': OBSERVER_EDITOR.has(key),
      'tablet:observer': DEFAULTS.observer.has(key),
      'tablet:noAccount': DEFAULTS.observer.has(key) && !ACCOUNT_KEYS.includes(key),
    }
    return [...['provider', 'admin', 'observer'].filter(office), ...TABLET_READERS.filter(actor => tablet[actor])]
  },
}

/** Routes without a session. */
const PUBLIC_ROUTES = {
  'health.get.ts': 'health check',
  'auth/login.post.ts': 'the login itself',
}
const PUBLIC_ACTORS = ['anonymous', 'provider', 'admin', 'observer', 'terminal']

/**
 * Route files that look at the role themselves, and why that is no access check. Any other route file that does
 * stops the script, so a new role check inside a route is not missed.
 */
const ROLE_USES = {
  'auth/login.post.ts': 'session lifetime: the tablet stays logged in (no access check)',
  'employees/index.get.ts': 'passes the role to the service, which strips the contract fields (data, no 403)',
  'level-ups.get.ts': 'passes the role to the service, which returns an empty list without contract right (no 403)',
}
const ROLE_USE = /\.role\b|\bisManager\(|\bisProvider\b|\bmayEditChildren\(|\bassert(Provider|Manager)\(|'(provider|admin|observer|terminal)'/

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

export function routeFiles() {
  return readdirSync(API_DIR, { recursive: true })
    .map(file => relative(API_DIR, join(API_DIR, file)).split(sep).join('/'))
    .filter(file => file.endsWith('.ts'))
    .sort()
}

function order(actors) {
  return ACTORS.filter(actor => actors.includes(actor))
}

/** Who gets through the guards of one route file. */
export function routeAccess(route, code) {
  const source = stripComments(code)
  if (ROLE_USE.test(source) && !(route in ROLE_USES)) {
    throw new Error(`${route}: checks the role itself – classify it in ROLE_USES or the snapshot`)
  }
  const calls = [...source.matchAll(/\b(require[A-Z]\w*)\(([^)]*)\)/g)]
  if (calls.length === 0) {
    if (!(route in PUBLIC_ROUTES)) throw new Error(`${route}: no guard and not a public route`)
    return [...PUBLIC_ACTORS]
  }
  if (route in PUBLIC_ROUTES) throw new Error(`${route}: listed as public but calls ${calls[0][1]}`)
  let allowed = null
  for (const [, name, args] of calls) {
    if (!(name in GUARDS)) throw new Error(`${route}: unknown guard ${name}`)
    const passes = GUARDS[name](args)
    if (passes !== null) allowed = allowed === null ? passes : allowed.filter(actor => passes.includes(actor))
  }
  if (allowed === null) throw new Error(`${route}: only requireFacility, no role guard`)
  return order(allowed)
}

export function snapshot() {
  const result = {}
  for (const route of routeFiles()) result[route] = routeAccess(route, readFileSync(join(API_DIR, route), 'utf8'))
  return result
}

/** One route per line, so a diff shows exactly which route changed. */
export function format(access) {
  const lines = Object.entries(access).map(([route, actors]) => `  ${JSON.stringify(route)}: ${JSON.stringify(actors)}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const text = format(snapshot())
  if (process.argv.includes('--check')) {
    // Git may check the file out with CRLF line ends.
    const current = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n')
    if (current !== text) {
      console.error('route-access-before.json differs from the guards in server/api')
      process.exit(1)
    }
    console.log('route-access-before.json matches the guards in server/api')
  }
  else {
    writeFileSync(OUT, text)
    console.log(`wrote ${Object.keys(JSON.parse(text)).length} routes to ${relative(ROOT, OUT)}`)
  }
}
