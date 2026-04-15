import { NextRequest, NextResponse } from 'next/server'
import { updateJobStatus } from '@/lib/services/jobService'
import { JobStatus, JOB_STATUSES } from '@/lib/models/PrintJob'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const body = await request.json()
    const { status, error } = body

    if (!status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    if (!JOB_STATUSES.includes(status as JobStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${JOB_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    const job = await updateJobStatus(jobId, status as JobStatus, error)

    // Also emit via global.io if available
    if (global.io && job.userId) {
      global.io.to(`user_${job.userId}`).emit('job:update', {
        jobId,
        status,
        error: error || null,
        timestamp: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        error: job.error,
        updatedAt: job.updatedAt,
      },
    })
  } catch (error) {
    const err = error as Error
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('[POST /api/printers/jobs/[jobId]/status]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
