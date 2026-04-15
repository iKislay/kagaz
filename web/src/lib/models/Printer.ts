import mongoose, { Document, Schema } from 'mongoose'

export interface IPrinter extends Document {
  printerId: string
  name: string
  location: {
    address: string
    city?: string
    pincode?: string
    coordinates: {
      type: 'Point'
      coordinates: [number, number] // [longitude, latitude]
    }
  }
  ipAddress: string
  port: number
  apiKey: string
  status: 'online' | 'offline' | 'busy'
  capabilities: {
    color: boolean
    duplex: boolean
    maxPageSize: string
  }
  stats: {
    totalJobs: number
    successfulJobs: number
    failedJobs: number
    lastJobAt?: Date
  }
  lastSeen: Date
  createdAt: Date
  updatedAt: Date
  getUrl(): string
  isStale(): boolean
}

const PrinterSchema = new Schema<IPrinter>(
  {
    printerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      address: { type: String, required: true },
      city: String,
      pincode: String,
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number],
          required: true,
        },
      },
    },
    ipAddress: {
      type: String,
      required: true,
    },
    port: {
      type: Number,
      default: 5000,
    },
    apiKey: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'busy'],
      default: 'offline',
      index: true,
    },
    capabilities: {
      color: { type: Boolean, default: false },
      duplex: { type: Boolean, default: false },
      maxPageSize: { type: String, default: 'A4' },
    },
    stats: {
      totalJobs: { type: Number, default: 0 },
      successfulJobs: { type: Number, default: 0 },
      failedJobs: { type: Number, default: 0 },
      lastJobAt: Date,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
)

// 2dsphere index for geospatial queries
PrinterSchema.index({ 'location.coordinates': '2dsphere' })

PrinterSchema.methods.getUrl = function (): string {
  return `http://${this.ipAddress}:${this.port}`
}

PrinterSchema.methods.isStale = function (): boolean {
  const staleThresholdMs = 10 * 60 * 1000 // 10 minutes
  return Date.now() - this.lastSeen.getTime() > staleThresholdMs
}

const Printer =
  (mongoose.models.Printer as mongoose.Model<IPrinter>) ||
  mongoose.model<IPrinter>('Printer', PrinterSchema)

export default Printer
