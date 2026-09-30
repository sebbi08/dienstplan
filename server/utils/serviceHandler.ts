import type { EventHandlerRequest, H3Event } from 'h3'
import { ServiceError } from '../lib/errors'

export function defineServiceHandler<T>(handler: (event: H3Event<EventHandlerRequest>) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (error) {
      if (error instanceof ServiceError) {
        throw createError({ statusCode: error.statusCode, statusMessage: error.code, data: { code: error.code } })
      }
      throw error
    }
  })
}
