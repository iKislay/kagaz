const API_BASE = 'https://graph.facebook.com/v21.0'

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
}

function config() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) {
    throw new Error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID')
  }
  return { accessToken, phoneNumberId }
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  const { accessToken, phoneNumberId } = config()

  const res = await fetch(`${API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[whatsapp] send failed:', err)
    throw new Error(`WhatsApp send failed: ${res.status}`)
  }
}

export async function downloadMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const { accessToken } = config()

  // Get the download URL from Meta
  const metaRes = await fetch(`${API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch media metadata: ${metaRes.status}`)
  }
  const { url, mime_type } = (await metaRes.json()) as { url: string; mime_type: string }

  // Download the actual file
  const fileRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!fileRes.ok) {
    throw new Error(`Failed to download media: ${fileRes.status}`)
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer())
  const ext = MIME_TO_EXT[mime_type] || 'bin'
  const filename = `wa_${mediaId.slice(-8)}.${ext}`

  return { buffer, mimeType: mime_type, filename }
}
