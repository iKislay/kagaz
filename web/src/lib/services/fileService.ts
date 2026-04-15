import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/jpg',
  'image/png',
]

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

function getS3Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!
  if (!accountId) throw new Error('R2_ACCOUNT_ID environment variable is not set')

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export function validateFile(
  filename: string,
  mimeType: string,
  sizeBytes: number
): { valid: boolean; error?: string } {
  if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `File type not supported. Supported: PDF, DOC, DOCX, JPG, PNG`,
    }
  }

  if (sizeBytes > MAX_FILE_SIZE) {
    const maxSizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)
    return {
      valid: false,
      error: `File too large. Maximum size: ${maxSizeMB}MB`,
    }
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safeName || safeName.length === 0) {
    return {
      valid: false,
      error: 'Invalid filename',
    }
  }

  return { valid: true }
}

function getExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
  }
  return mimeToExt[mimeType] || 'bin'
}

export async function uploadToR2(
  file: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME!
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set')
  }

  const ext = getExtension(mimeType)
  const safeName = filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/\.[^.]+$/, '')
    .substring(0, 50)
  const key = `uploads/${randomUUID()}-${safeName}.${ext}`

  const s3 = getS3Client()

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file,
      ContentType: mimeType,
      ContentDisposition: `inline; filename="${safeName}.${ext}"`,
    })
  )

  // Return the public URL via R2's public bucket domain (set in Cloudflare dashboard)
  const publicDomain = process.env.R2_PUBLIC_URL!
  if (!publicDomain) {
    throw new Error('R2_PUBLIC_URL environment variable is not set')
  }
  return `${publicDomain.replace(/\/$/, '')}/${key}`
}

export async function generatePresignedUrl(key: string): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME!
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set')
  }

  const s3 = getS3Client()

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  })

  // Presigned URL valid for 1 hour
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 })
  return url
}

export async function deleteFromR2(key: string): Promise<void> {
  const bucketName = process.env.R2_BUCKET_NAME!
  if (!bucketName) {
    throw new Error('R2_BUCKET_NAME environment variable is not set')
  }

  const s3 = getS3Client()

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  )
}
