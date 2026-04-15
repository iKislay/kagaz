import { NextRequest, NextResponse } from 'next/server'
import { extractTokenFromRequest, getOrCreateGuestUser } from '@/lib/auth'
import { createJob } from '@/lib/services/jobService'
import { findByPrinterId } from '@/lib/services/printerService'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Verify guest token
    const auth = await extractTokenFromRequest(request)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateGuestUser(auth.token)

    const body = await request.json()
    const { printerId, settings } = body

    if (!printerId) {
      return NextResponse.json({ error: 'printerId is required' }, { status: 400 })
    }

    // Validate settings
    const printSettings = {
      copies: Math.max(1, Math.min(99, parseInt(settings?.copies) || 1)),
      color: Boolean(settings?.color),
      duplex: Boolean(settings?.duplex),
      pageSize: settings?.pageSize || 'A4',
    }

    // Verify printer exists
    const printer = await findByPrinterId(printerId)
    if (!printer) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
    }

    if (printer.status === 'offline') {
      return NextResponse.json(
        { error: 'Printer is currently offline' },
        { status: 409 }
      )
    }

    // Get files from user's session
    if (!user.files || user.files.length === 0) {
      return NextResponse.json(
        { error: 'No files uploaded. Please upload files first.' },
        { status: 400 }
      )
    }

    const fileUrls = user.files.map((f) => ({
      url: f.url,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
    }))

    // Create the print job (also emits job:new to printer via socket.io)
    const job = await createJob({
      userId: user._id.toString(),
      printerId: printer.printerId,
      fileUrls,
      settings: printSettings,
    })

    return NextResponse.json(
      {
        jobId: job.jobId,
        status: job.status,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[POST /api/jobs/print]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
