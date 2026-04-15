import mongoose, { Document, Schema } from 'mongoose'

export interface IFileMetadata {
  url: string
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedAt: Date
}

export interface IUser extends Document {
  guestToken: string
  sessionId?: string
  files: IFileMetadata[]
  createdAt: Date
  expiresAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    guestToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sessionId: {
      type: String,
    },
    files: [
      {
        url: { type: String, required: true },
        filename: { type: String, required: true },
        mimeType: { type: String, required: true },
        sizeBytes: { type: Number, required: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      index: { expires: 0 }, // TTL index - document expires at this date
    },
  },
  { timestamps: true }
)

const User =
  (mongoose.models.WebUser as mongoose.Model<IUser>) ||
  mongoose.model<IUser>('WebUser', UserSchema)

export default User
