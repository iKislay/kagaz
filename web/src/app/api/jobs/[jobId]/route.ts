import { NextRequest, NextResponse } from 'next/server'
import { extractTokenFromRequest, getOrCreateGuestUser } from '@/lib/auth'
import { getJobById } from '@/lib/services/jobService'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    // Verify guest token
    const auth = await extractTokenFromRequest(request)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getOrCreateGuestUser(auth.token)

    const job = await getJobById(jobId)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Ensure user can only access their own jobs
    if (job.userId !== user._id.toString()) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({
      job: {
        jobId: job.jobId,
        status: job.status,
        statusHistory: job.statusHistory,
        files: job.files.map((f) => ({
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        })),
        settings: job.settings,
        error: job.error,
        metadata: job.metadata,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
    })
  } catch (error) {
    console.error('[GET /api/jobs/[jobId]]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
