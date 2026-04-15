import { NextRequest, NextResponse } from 'next/server'
import { extractTokenFromRequest } from '@/lib/auth'
import { findNearbyPrinters } from '@/lib/services/printerService'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Verify guest token
    const auth = await extractTokenFromRequest(request)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const latStr = searchParams.get('lat')
    const lngStr = searchParams.get('lng')
    const radiusStr = searchParams.get('radius')

    if (!latStr || !lngStr) {
      return NextResponse.json({ error: 'lat and lng query parameters are required' }, { status: 400 })
    }

    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: 'lat and lng must be valid numbers' }, { status: 400 })
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 })
    }

    const radiusMeters = radiusStr ? parseInt(radiusStr) : 5000

    const printers = await findNearbyPrinters(lat, lng, radiusMeters)

    return NextResponse.json({ printers })
  } catch (error) {
    console.error('[GET /api/printers/nearby]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
