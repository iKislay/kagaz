import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'crypto'
import connectDB from '@/lib/db'
import User, { IUser } from '@/lib/models/User'

export interface GuestPayload {
  sub: string
  jti: string
  iat: number
  exp: number
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export async function createGuestToken(): Promise<string> {
  const secret = getJwtSecret()
  const jti = randomUUID()

  const token = await new SignJWT({ sub: 'guest' })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret)

  return token
}

export async function verifyGuestToken(token: string): Promise<GuestPayload | null> {
  try {
    const secret = getJwtSecret()
    const { payload } = await jwtVerify(token, secret)

    if (payload.sub !== 'guest' || !payload.jti) {
      return null
    }

    return payload as unknown as GuestPayload
  } catch {
    return null
  }
}

export async function getOrCreateGuestUser(token: string): Promise<IUser> {
  await connectDB()

  const payload = await verifyGuestToken(token)
  if (!payload) {
    throw new Error('Invalid or expired guest token')
  }

  const jti = payload.jti

  let user = await User.findOne({ guestToken: jti })

  if (!user) {
    user = await User.create({
      guestToken: jti,
      files: [],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
  }

  return user
}

export async function extractTokenFromRequest(
  request: Request
): Promise<{ token: string; payload: GuestPayload } | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = await verifyGuestToken(token)

  if (!payload) {
    return null
  }

  return { token, payload }
}
