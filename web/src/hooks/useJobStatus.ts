'use client'

import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

export type JobStatus = 'PENDING' | 'PROCESSING' | 'PRINTING' | 'COMPLETED' | 'FAILED'

export interface StatusHistoryEntry {
  status: JobStatus
  timestamp: string
  message?: string
}

interface JobStatusState {
  status: JobStatus | null
  statusHistory: StatusHistoryEntry[]
  error: string | null
  connected: boolean
}

interface JobUpdateEvent {
  jobId: string
  status: JobStatus
  error?: string | null
  timestamp: string
}

export function useJobStatus(
  jobId: string | null,
  userId: string | null
): JobStatusState {
  const [state, setState] = useState<JobStatusState>({
    status: null,
    statusHistory: [],
    error: null,
    connected: false,
  })

  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!jobId || !userId) return

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    const socket = io(appUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true',
      },
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setState((prev) => ({ ...prev, connected: true }))
      // Join the user's personal room
      socket.emit('user:join', { userId })
    })

    socket.on('disconnect', () => {
      setState((prev) => ({ ...prev, connected: false }))
    })

    socket.on('job:update', (data: JobUpdateEvent) => {
      if (data.jobId !== jobId) return

      setState((prev) => ({
        ...prev,
        status: data.status,
        error: data.error || null,
        statusHistory: [
          ...prev.statusHistory,
          {
            status: data.status,
            timestamp: data.timestamp,
            message: data.error || undefined,
          },
        ],
      }))
    })

    socket.on('connect_error', (err) => {
      console.error('[useJobStatus] Socket connection error:', err.message)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [jobId, userId])

  return state
}
