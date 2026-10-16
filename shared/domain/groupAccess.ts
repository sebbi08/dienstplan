import type { GroupAccess } from '../types/api'

/** What a viewer may do with a group's children and group book: enter and change, only read, or not even see. */
export type GroupRight = 'write' | 'read' | 'none'

/**
 * The viewer's right in a group (`groupId` null = a child without group). Without group access (`null`: Leitung,
 * Träger, staff without group, helpers) and for children without group: write, within the viewer's other rights.
 * Otherwise the own group is writable, the granted ones are readable, every other group is hidden.
 */
export function groupRight(groupId: number | null, access: GroupAccess | null): GroupRight {
  if (access === null || groupId === null || groupId === access.own) return 'write'
  return access.readable.includes(groupId) ? 'read' : 'none'
}
