import { describe, expect, it } from 'vitest'
import { isManager } from '../../shared/domain/roles'

// Who may edit child records is a right now (the bundle „eintragen und Akten ändern“, see permissionBundles.test.ts);
// the role only says who someone is.
describe('isManager', () => {
  it('names Träger and Leitung, nobody else', () => {
    expect(['provider', 'admin', 'observer', 'terminal', null, undefined].map(role => isManager(role as never)))
      .toEqual([true, true, false, false, false, false])
  })
})
