import { NextResponse } from 'next/server'
import { createGuestToken, verifyGuestToken } from '@/lib/auth'
import connectDB from '@/lib/db'
import User from '@/lib/models/User'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const token = await createGuestToken()
    const payload = await verifyGuestToken(token)

    if (!payload) {
      return NextResponse.json({ error: 'Failed to create token' }, { status: 500 })
    }

    await connectDB()

    // Create the User record in MongoDB keyed by jti
    const user = await User.findOneAndUpdate(
      { guestToken: payload.jti },
      {
        $setOnInsert: {
          guestToken: payload.jti,
          files: [],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true, new: true }
    )

    return NextResponse.json(
      {
        token,
        userId: user._id.toString(),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[POST /api/auth/guest]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
