'use client'

import { useState, useEffect } from 'react'

interface GuestAuthState {
  token: string | null
  userId: string | null
  loading: boolean
  error: string | null
}

function isTokenExpired(token: string): boolean {
  try {
    // JWT is base64url encoded: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) return true

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (!payload.exp) return false

    // exp is in seconds, Date.now() is in milliseconds
    // Add 60s buffer to avoid edge cases
    return Date.now() / 1000 > payload.exp - 60
  } catch {
    return true
  }
}

async function fetchGuestToken(): Promise<{ token: string; userId: string }> {
  const response = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true' // Bypasses ngrok's anti-phishing HTML page
    },
  })

  if (!response.ok) {
    throw new Error('Failed to create guest session')
  }

  return response.json()
}

export function useGuestAuth(): GuestAuthState {
  const [state, setState] = useState<GuestAuthState>({
    token: null,
    userId: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    async function initAuth() {
      try {
        // Check localStorage for an existing token
        const storedToken = localStorage.getItem('kagaz_guest_token')
        const storedUserId = localStorage.getItem('kagaz_user_id')

        if (storedToken && storedUserId && !isTokenExpired(storedToken)) {
          setState({
            token: storedToken,
            userId: storedUserId,
            loading: false,
            error: null,
          })
          return
        }

        // Token missing or expired — fetch a new one
        const { token, userId } = await fetchGuestToken()

        localStorage.setItem('kagaz_guest_token', token)
        localStorage.setItem('kagaz_user_id', userId)

        setState({ token, userId, loading: false, error: null })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setState({ token: null, userId: null, loading: false, error: message })
      }
    }

    initAuth()
  }, [])

  return state
}
