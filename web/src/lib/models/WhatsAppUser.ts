import mongoose, { Document, Schema } from 'mongoose'

export type BotState = 'IDLE' | 'SELECTING_PRINTER' | 'UPLOADING' | 'AWAITING_SAVE_PREFERENCE'

export interface ISessionFile {
  mediaId: string
  filename: string
  mimeType: string
  url: string
  sizeBytes: number
}

export interface IPrinterOption {
  printerId: string
  name: string
  address: string
  distance: number
  distanceText: string
}

export interface IWhatsAppUser extends Document {
  phoneNumber: string
  state: BotState
  selectedPrinterId?: string
  selectedPrinterName?: string
  printerOptions: IPrinterOption[]
  files: ISessionFile[]
  savedPrinterId?: string
  savedPrinterName?: string
  lastJobId?: string
  lastActive: Date
}

const WhatsAppUserSchema = new Schema<IWhatsAppUser>(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    state: {
      type: String,
      enum: ['IDLE', 'SELECTING_PRINTER', 'UPLOADING', 'AWAITING_SAVE_PREFERENCE'],
      default: 'IDLE',
    },
    selectedPrinterId: String,
    selectedPrinterName: String,
    printerOptions: [
      {
        printerId: String,
        name: String,
        address: String,
        distance: Number,
        distanceText: String,
      },
    ],
    files: [
      {
        mediaId: { type: String, required: true },
        filename: { type: String, required: true },
        mimeType: { type: String, required: true },
        url: { type: String, required: true },
        sizeBytes: { type: Number, required: true },
      },
    ],
    savedPrinterId: String,
    savedPrinterName: String,
    lastJobId: String,
    lastActive: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
)

// Auto-expire sessions inactive for 30 minutes
WhatsAppUserSchema.index({ lastActive: 1 }, { expireAfterSeconds: 30 * 60 })

const WhatsAppUser =
  (mongoose.models.WhatsAppUser as mongoose.Model<IWhatsAppUser>) ||
  mongoose.model<IWhatsAppUser>('WhatsAppUser', WhatsAppUserSchema)

export default WhatsAppUser
