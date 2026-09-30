import { loginSchema } from '../../schemas'
import { login } from '../../services/auth'

export default defineServiceHandler(async (event) => {
  const body = await readValidatedBody(event, loginSchema.parse)
  const result = login(useDb(), body.username, body.password)
  if (!result.ok) {
    const code = result.reason === 'locked' ? 'login_locked' : 'login_invalid'
    throw createError({ statusCode: 401, statusMessage: code, data: { code } })
  }
  await setUserSession(event, { user: result.user })
  return result.user
})
