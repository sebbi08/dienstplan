import { z } from 'zod'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const minutes = z.number().int().min(0).max(1440)

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
})

export const passwordChangeSchema = z.object({
  currentPassword: z.string().max(200),
  newPassword: z.string().max(200),
})
