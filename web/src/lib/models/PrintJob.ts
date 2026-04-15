import mongoose, { Document, Schema } from 'mongoose'

export type JobStatus = 'PENDING' | 'PROCESSING' | 'PRINTING' | 'COMPLETED' | 'FAILED'

export const JOB_STATUSES: JobStatus[] = [
  'PENDING',
  'PROCESSING',
  'PRINTING',
  'COMPLETED',
  'FAILED',
]

export interface IFileEntry {
  filename: string
  url: string
  mimeType: string
  sizeBytes: number
}

export interface IStatusHistory {
  status: JobStatus
  timestamp: Date
  message?: string
}

export interface IPrintSettings {
  copies: number
  color: boolean
  duplex: boolean
  pageSize: string
}

export interface IPrintJob extends Document {
  jobId: string
  userId: string
  printerId: string
  files: IFileEntry[]
  settings: IPrintSettings
  status: JobStatus
  statusHistory: IStatusHistory[]
  error?: string | null
  metadata?: {
    totalPages?: number
    estimatedDuration?: number
  }
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const PrintJobSchema = new Schema<IPrintJob>(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    printerId: {
      type: String,
      required: true,
      index: true,
    },
    files: [
      {
        filename: { type: String, required: true },
        url: { type: String, required: true },
        mimeType: { type: String, required: true },
        sizeBytes: { type: Number, required: true },
      },
    ],
    settings: {
      copies: { type: Number, default: 1 },
      color: { type: Boolean, default: false },
      duplex: { type: Boolean, default: false },
      pageSize: { type: String, default: 'A4' },
    },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: 'PENDING',
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, enum: JOB_STATUSES, required: true },
        timestamp: { type: Date, default: Date.now },
        message: String,
      },
    ],
    error: {
      type: String,
      default: null,
    },
    metadata: {
      totalPages: Number,
      estimatedDuration: Number,
    },
    completedAt: Date,
  },
  { timestamps: true }
)

PrintJobSchema.index({ createdAt: 1 })

// Pre-save: append status to history and set completedAt
PrintJobSchema.pre('save', function () {
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date(),
      message: this.error || undefined,
    })

    if (this.status === 'COMPLETED' || this.status === 'FAILED') {
      this.completedAt = new Date()
    }
  }
})

const PrintJob =
  (mongoose.models.PrintJob as mongoose.Model<IPrintJob>) ||
  mongoose.model<IPrintJob>('PrintJob', PrintJobSchema)

export default PrintJob
