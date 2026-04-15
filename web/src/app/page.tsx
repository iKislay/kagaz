'use client'

import { useGuestAuth } from '@/hooks/useGuestAuth'
import PrintWizard from '@/components/PrintWizard'

export default function HomePage() {
  const { token, userId, loading, error } = useGuestAuth()

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-900">Kagaz</span>
          </div>
          <span className="text-sm text-gray-400">Print Anywhere</span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-start px-4 py-8">
        <div className="w-full max-w-2xl">
          {/* Hero text */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
              Print from your phone
            </h1>
            <p className="mt-3 text-lg text-gray-500">
              Upload your documents and print at a nearby kiosk — no app needed.
            </p>
          </div>

          {/* Auth loading / error states */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <span className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-gray-500">Setting up your session...</span>
            </div>
          )}

          {error && !loading && (
            <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center">
              <p className="text-red-600 font-semibold">Failed to start session</p>
              <p className="text-red-500 text-sm mt-1">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {/* Main wizard — shown once auth is ready */}
          {!loading && !error && token && userId && (
            <PrintWizard token={token} userId={userId} />
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-4">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-gray-400">
          Kagaz — Your files are encrypted and deleted after 24 hours.
        </div>
      </footer>
    </main>
  )
}
