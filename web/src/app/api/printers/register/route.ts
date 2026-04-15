import { NextRequest, NextResponse } from 'next/server'
import { registerOrUpdatePrinter } from '@/lib/services/printerService'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { printerId, name, location, ipAddress, port, apiKey, capabilities, status } = body

    // Validate required fields
    if (!printerId || !name || !location || !ipAddress || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: printerId, name, location, ipAddress, apiKey' },
        { status: 400 }
      )
    }

    // Validate location structure
    if (!location.address || !location.coordinates || !location.coordinates.coordinates) {
      return NextResponse.json(
        {
          error:
            'Invalid location format. Expected: { address, coordinates: { type: "Point", coordinates: [lng, lat] } }',
        },
        { status: 400 }
      )
    }

    const [lng, lat] = location.coordinates.coordinates
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return NextResponse.json({ error: 'Invalid coordinates in location' }, { status: 400 })
    }

    const printer = await registerOrUpdatePrinter({
      printerId,
      name,
      location: {
        address: location.address,
        city: location.city,
        pincode: location.pincode,
        coordinates: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      },
      ipAddress,
      port: port || 5000,
      apiKey,
      capabilities: capabilities || { color: false, duplex: false, maxPageSize: 'A4' },
      status: status || 'online',
    })

    return NextResponse.json({
      success: true,
      printer: {
        _id: printer._id.toString(),
        printerId: printer.printerId,
        name: printer.name,
        status: printer.status,
        lastSeen: printer.lastSeen,
      },
    })
  } catch (error) {
    console.error('[POST /api/printers/register]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
