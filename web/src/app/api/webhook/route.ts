import { NextRequest, NextResponse } from 'next/server'
import { handleMessage, IncomingMessage } from '@/lib/whatsappBot'

export const dynamic = 'force-dynamic'

// GET — Meta webhook verification handshake
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (!verifyToken) {
    return new NextResponse('Webhook verify token not configured', { status: 500 })
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[webhook] Verification successful')
    return new NextResponse(challenge, { status: 200 })
  }

  console.warn('[webhook] Verification failed — token mismatch')
  return new NextResponse('Forbidden', { status: 403 })
}

// POST — incoming WhatsApp messages
export async function POST(request: NextRequest) {
  let body: WhatsAppPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Acknowledge immediately (Meta requires 200 within 20s)
  processMessages(body).catch((err) =>
    console.error('[webhook] async processing error:', err)
  )

  return NextResponse.json({ status: 'ok' })
}

async function processMessages(body: WhatsAppPayload) {
  if (body.object !== 'whatsapp_business_account') return

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const messages = change.value?.messages ?? []
      for (const msg of messages) {
        try {
          await handleMessage(parseMessage(msg))
        } catch (err) {
          console.error('[webhook] message handler error:', err)
        }
      }
    }
  }
}

function parseMessage(raw: RawMessage): IncomingMessage {
  const base = { from: raw.from }

  switch (raw.type) {
    case 'text':
      return { ...base, type: 'text', text: raw.text?.body ?? '' }

    case 'document':
      return {
        ...base,
        type: 'document',
        media: {
          id: raw.document!.id,
          mimeType: raw.document!.mime_type,
          filename: raw.document!.filename,
        },
      }

    case 'image':
      return {
        ...base,
        type: 'image',
        media: {
          id: raw.image!.id,
          mimeType: raw.image!.mime_type,
        },
      }

    case 'location':
      return {
        ...base,
        type: 'location',
        location: {
          latitude: raw.location!.latitude,
          longitude: raw.location!.longitude,
        },
      }

    default:
      return { ...base, type: 'unknown' }
  }
}

// ── Type definitions for Meta's webhook payload ─────────────────────────────

interface WhatsAppPayload {
  object: string
  entry?: Array<{
    id: string
    changes?: Array<{
      value?: {
        messages?: RawMessage[]
      }
      field: string
    }>
  }>
}

interface RawMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  document?: { id: string; mime_type: string; filename?: string; sha256?: string }
  image?: { id: string; mime_type: string; sha256?: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
}
