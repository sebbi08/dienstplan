import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../server/lib/password'

describe('password hashing', () => {
  it('verifies the right password and rejects others', () => {
    const hash = hashPassword('correct horse')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse', hash)).toBe(true)
    expect(verifyPassword('wrong horse', hash)).toBe(false)
    expect(verifyPassword('correct horse', 'garbage')).toBe(false)
  })
  it('rejects stored hashes that do not decode to the full key length', () => {
    expect(verifyPassword('anything', 'scrypt$AA==$=')).toBe(false)
  })
  it('salts every hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })
})
