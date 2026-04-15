import { NextRequest, NextResponse } from 'next/server'
import { findByPrinterId } from '@/lib/services/printerService'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ printerId: string }> }
) {
  try {
    const { printerId } = await params

    if (!printerId) {
      return NextResponse.json({ error: 'printerId is required' }, { status: 400 })
    }

    const printer = await findByPrinterId(printerId)

    if (!printer) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
    }

    return NextResponse.json({
      printer: {
        _id: printer._id.toString(),
        printerId: printer.printerId,
        name: printer.name,
        status: printer.status,
        capabilities: printer.capabilities,
        location: {
          address: printer.location.address,
          city: printer.location.city,
          pincode: printer.location.pincode,
        },
        stats: printer.stats,
        lastSeen: printer.lastSeen,
        isStale: printer.isStale(),
      },
    })
  } catch (error) {
    console.error('[GET /api/printers/[printerId]/status]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
