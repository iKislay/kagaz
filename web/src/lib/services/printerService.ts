import connectDB from '@/lib/db'
import Printer from '@/lib/models/Printer'

export interface PrinterRegistrationData {
  printerId: string
  name: string
  location: {
    address: string
    city?: string
    pincode?: string
    coordinates: {
      type: 'Point'
      coordinates: [number, number]
    }
  }
  ipAddress: string
  port?: number
  apiKey: string
  capabilities?: {
    color?: boolean
    duplex?: boolean
    maxPageSize?: string
  }
  status?: 'online' | 'offline' | 'busy'
  isDefault?: boolean
}

export interface NearbyPrinter {
  _id: string
  printerId: string
  name: string
  address: string
  city?: string
  status: string
  capabilities: {
    color: boolean
    duplex: boolean
    maxPageSize: string
  }
  distance: number
  distanceText: string
  isDefault: boolean
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Earth's radius in meters
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function formatPrinter(printer: InstanceType<typeof Printer>, lat: number, lng: number): NearbyPrinter {
  const [pLng, pLat] = printer.location.coordinates.coordinates
  const distance = calculateDistance(lat, lng, pLat, pLng)
  return {
    _id: printer._id.toString(),
    printerId: printer.printerId,
    name: printer.name,
    address: printer.location.address,
    city: printer.location.city,
    status: printer.status,
    capabilities: printer.capabilities,
    isDefault: printer.isDefault ?? false,
    distance: Math.round(distance),
    distanceText:
      distance < 1000
        ? `${Math.round(distance)}m away`
        : `${(distance / 1000).toFixed(1)}km away`,
  }
}

export async function findNearbyPrinters(
  lat: number | null,
  lng: number | null,
  radiusMeters = 5000
): Promise<NearbyPrinter[]> {
  await connectDB()

  // No coordinates — return all online printers sorted by default first
  if (lat === null || lng === null) {
    const all = await Printer.find({ status: 'online' }).sort({ isDefault: -1, name: 1 })
    return all.map((p) => formatPrinter(p, 0, 0))
  }

  const [nearby, defaults] = await Promise.all([
    Printer.find({
      status: 'online',
      'location.coordinates': {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radiusMeters,
        },
      },
    }).limit(10),
    Printer.find({ isDefault: true, status: 'online' }),
  ])

  // Merge defaults first, then nearby — deduplicate by printerId
  const seen = new Set<string>()
  const merged: NearbyPrinter[] = []

  for (const p of [...defaults, ...nearby]) {
    if (!seen.has(p.printerId)) {
      seen.add(p.printerId)
      merged.push(formatPrinter(p, lat, lng))
    }
  }

  return merged
}

export async function findByPrinterId(printerId: string) {
  await connectDB()
  return Printer.findOne({ printerId: printerId.toUpperCase() })
}

export async function updatePrinterStatus(
  printerId: string,
  status: 'online' | 'offline' | 'busy'
) {
  await connectDB()
  return Printer.findOneAndUpdate(
    { printerId: printerId.toUpperCase() },
    { status, lastSeen: new Date() },
    { new: true }
  )
}

export async function registerOrUpdatePrinter(data: PrinterRegistrationData) {
  await connectDB()

  const update = {
    name: data.name,
    location: data.location,
    ipAddress: data.ipAddress,
    port: data.port || 5000,
    apiKey: data.apiKey,
    capabilities: data.capabilities || { color: false, duplex: false, maxPageSize: 'A4' },
    status: data.status || 'online',
    isDefault: data.isDefault ?? false,
    lastSeen: new Date(),
  }

  const printer = await Printer.findOneAndUpdate(
    { printerId: data.printerId.toUpperCase() },
    { $set: update },
    { upsert: true, new: true, runValidators: true }
  )

  return printer
}

export async function markStalePrintersOffline(): Promise<number> {
  await connectDB()

  const staleThresholdMs = 10 * 60 * 1000
  const staleTime = new Date(Date.now() - staleThresholdMs)

  const result = await Printer.updateMany(
    {
      status: { $in: ['online', 'busy'] },
      lastSeen: { $lt: staleTime },
    },
    { status: 'offline' }
  )

  return result.modifiedCount
}
