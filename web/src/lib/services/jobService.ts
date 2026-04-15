import connectDB from '@/lib/db'
import PrintJob, { JobStatus, IPrintSettings } from '@/lib/models/PrintJob'

export interface CreateJobParams {
  userId: string
  printerId: string
  fileUrls: Array<{ url: string; filename: string; mimeType: string; sizeBytes: number }>
  settings: IPrintSettings
}

function generateJobId(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `JOB${year}${month}${day}${hours}${minutes}${seconds}${random}`
}

export async function createJob(params: CreateJobParams) {
  await connectDB()

  const { userId, printerId, fileUrls, settings } = params
  const jobId = generateJobId()

  const job = await PrintJob.create({
    jobId,
    userId,
    printerId,
    files: fileUrls.map((f) => ({
      filename: f.filename,
      url: f.url,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
    })),
    settings,
    status: 'PENDING',
  })

  // Emit to printer via Socket.io
  if (global.io) {
    global.io.to(printerId.toUpperCase()).emit('job:new', {
      jobId,
      userId,
      fileUrls: fileUrls.map((f) => f.url),
      settings,
    })
    console.log('[jobService] Emitted job:new to printer room:', printerId.toUpperCase())
  } else {
    console.warn('[jobService] global.io not available, could not emit job:new')
  }

  return job
}

export async function updateJobStatus(jobId: string, status: JobStatus, message?: string) {
  await connectDB()

  const job = await PrintJob.findOne({ jobId })
  if (!job) {
    throw new Error(`Job not found: ${jobId}`)
  }

  job.status = status
  if (message) {
    if (status === 'FAILED') {
      job.error = message
    }
  }

  await job.save()

  // Emit update to user's browser via Socket.io
  if (global.io && job.userId) {
    global.io.to(`user_${job.userId}`).emit('job:update', {
      jobId,
      status,
      error: job.error || null,
      timestamp: new Date().toISOString(),
    })
  }

  return job
}

export async function getJobById(jobId: string) {
  await connectDB()
  return PrintJob.findOne({ jobId })
}
