import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const MIN_PASSWORD_LENGTH = 8
const KEY_LENGTH = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, hash] = stored.split('$')
  if (algorithm !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  if (expected.length !== KEY_LENGTH) return false
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}
