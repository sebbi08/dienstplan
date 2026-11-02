import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../scripts/route-access-snapshot.mjs'

/**
 * scripts/route-access-snapshot.mjs runs in plain Node and imports shared/domain/permissions.ts through Node's type
 * stripping. This fails clearly when that import breaks (an extensionless relative import or TS-only syntax such as an
 * enum in permissions.ts) or when the guards no longer match the frozen fixture.
 */
describe('route access snapshot script', () => {
  it('runs in plain Node and finds the guards matching route-access-before.json', () => {
    const run = spawnSync(process.execPath, [join(process.cwd(), 'scripts', 'route-access-snapshot.mjs'), '--check'],
      { encoding: 'utf8' })
    expect(run.stderr, 'the script failed (see its error output)').not.toMatch(/Error|differs/)
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('route-access-before.json matches the guards in server/api')
  })
})

describe('stripComments of the script', () => {
  it('drops line, trailing and block comments', () => {
    const code = 'a()\n// whole line\nb() // trailing requireAdmin(event)\n/* block\n requireProvider(event) */ c()\n'
    expect(stripComments(code).replace(/\s+/g, ' ').trim()).toBe('a() b() c()')
  })

  it('keeps comment markers inside strings, template literals and regex literals', () => {
    const code = [
      'const url = \'http://x/*y\'', 'const glob = "a/*b*/"', 'const t = `//${x}`', 'const re = /\\/\\*|\'/g // gone', 'next()',
    ].join('\n')
    expect(stripComments(code)).toBe([
      'const url = \'http://x/*y\'', 'const glob = "a/*b*/"', 'const t = `//${x}`', 'const re = /\\/\\*|\'/g ', 'next()',
    ].join('\n'))
  })

  it('does not take a division for a regex', () => {
    expect(stripComments('const half = total / 2 // comment\nconst r = a / b / c')).toBe('const half = total / 2 \nconst r = a / b / c')
  })
})
