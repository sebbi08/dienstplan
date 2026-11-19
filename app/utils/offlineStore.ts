import type { StampAction } from '#shared/types/api'
import type { QueuedStamp } from './offlineQueue'

/**
 * The tablet's browser storage for stamping without network (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“), in
 * IndexedDB „dienstplan-terminal“: the team list for stamping (employee ids and names, nothing else), the queue of
 * offline stamps, and the device's key for the PINs in the queue. The key is an AES-GCM key generated on the device and
 * not extractable: the PIN is kept encrypted and leaves the device only with the request that transfers it; the stamp
 * and its PIN are deleted as soon as the server answered for it. Browser only (needs a secure context for Web Crypto).
 */

const DB_NAME = 'dienstplan-terminal'
const DB_VERSION = 1
const TEAM = 'team'
const QUEUE = 'queue'
const KEYS = 'keys'

export interface TeamMember { employeeId: number; name: string }

let opening: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(TEAM)) db.createObjectStore(TEAM)
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'seq', autoIncrement: true })
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function database(): Promise<IDBDatabase> {
  opening ??= openDb().catch((error: unknown) => {
    opening = null
    throw error
  })
  return opening
}

/** Runs `work` in one transaction of the store and resolves with the last request's result once the transaction is done. */
async function inStore<T>(name: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode)
    const request = work(transaction.objectStore(name))
    transaction.oncomplete = () => resolve(request ? request.result : undefined)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

/** Whether this browser can keep offline stamps (IndexedDB and Web Crypto in a secure context). */
export function offlineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && crypto.subtle !== undefined
}

/** Replaces the cached team list: only employee id and name of each person, in the tablet's order. */
export async function saveTeam(people: readonly TeamMember[]): Promise<void> {
  const list = people.map(person => ({ employeeId: person.employeeId, name: person.name }))
  await inStore(TEAM, 'readwrite', store => store.put(list, 'list'))
}

/** Forgets the cached team list (the tablet account signed out); the queue stays. */
export async function clearTeam(): Promise<void> {
  await inStore(TEAM, 'readwrite', store => store.delete('list'))
}

export async function loadTeam(): Promise<TeamMember[]> {
  return (await inStore<TeamMember[]>(TEAM, 'readonly', store => store.get('list'))) ?? []
}

let keyLoading: Promise<CryptoKey> | null = null

/** The device's PIN key: generated once, not extractable, kept in IndexedDB (a CryptoKey is stored as it is). */
function pinKey(): Promise<CryptoKey> {
  keyLoading ??= (async () => {
    const stored = await inStore<CryptoKey>(KEYS, 'readonly', store => store.get('pin'))
    if (stored) return stored
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await inStore(KEYS, 'readwrite', store => store.put(key, 'pin'))
    return key
  })().catch((error: unknown) => {
    keyLoading = null
    throw error
  })
  return keyLoading
}

async function encryptPin(pin: string): Promise<QueuedStamp['pin']> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pinKey(), new TextEncoder().encode(pin))
  return { iv, data }
}

export async function decryptPin(pin: QueuedStamp['pin']): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: pin.iv }, await pinKey(), pin.data)
  return new TextDecoder().decode(plain)
}

/** Puts a stamp into the queue with a random client id; the PIN only encrypted. */
export async function enqueueStamp(stamp: {
  employeeId: number; name: string; action: StampAction; stampedAt: string; pin: string
}): Promise<void> {
  const entry: Omit<QueuedStamp, 'seq'> = {
    clientId: crypto.randomUUID(), employeeId: stamp.employeeId, name: stamp.name, action: stamp.action,
    stampedAt: stamp.stampedAt, pin: await encryptPin(stamp.pin),
  }
  await inStore(QUEUE, 'readwrite', store => store.add(entry))
}

export async function loadQueue(): Promise<QueuedStamp[]> {
  return (await inStore<QueuedStamp[]>(QUEUE, 'readonly', store => store.getAll())) ?? []
}

export async function queueSize(): Promise<number> {
  return (await inStore<number>(QUEUE, 'readonly', store => store.count())) ?? 0
}

/** Deletes the answered stamps with their encrypted PINs. */
export async function removeFromQueue(clientIds: readonly string[]): Promise<void> {
  if (clientIds.length === 0) return
  const done = new Set(clientIds)
  const queued = await loadQueue()
  await inStore(QUEUE, 'readwrite', (store) => {
    for (const entry of queued) if (done.has(entry.clientId)) store.delete(entry.seq)
  })
}
