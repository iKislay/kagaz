'use client'

import { useGuestAuth } from '@/hooks/useGuestAuth'
import PrintWizard from '@/components/PrintWizard'

export default function HomePage() {
  const { token, userId, loading, error } = useGuestAuth()

  return (
    <main className="flex-1 flex flex-col bg-canvas min-h-screen text-white">
      {/* Header */}
      <header className="w-full max-w-[1280px] mx-auto px-6 py-6 flex flex-col items-start justify-between border-b-0 relative z-10">
        <div className="flex flex-col md:flex-row items-baseline gap-4 md:gap-12 w-full">
          {/* Huge Wordmark Hero scale */}
          <span className="text-[60px] md:text-[107px] font-display leading-[0.80] tracking-[1.07px] uppercase mt-4">
            Kagaz
          </span>
          <nav className="flex items-center gap-6 mt-4 pb-2">
            <span className="font-mono text-[12px] md:text-[14px] uppercase tracking-[1.5px] hover:text-deepblue cursor-pointer transition-colors">
              Features
            </span>
            <span className="font-mono text-[12px] md:text-[14px] uppercase tracking-[1.5px] hover:text-deepblue cursor-pointer transition-colors">
              Locations
            </span>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-start px-6 py-12 md:py-16 w-full max-w-[1280px] mx-auto relative z-10">
        <div className="w-full flex flex-col items-center">
          {/* Hero text */}
          <div className="text-center mb-16 md:mb-24 flex flex-col items-center w-full">
            {/* capitalized thin-weight poly-sans label equivalent */}
            <span className="block font-sans font-light text-[19px] uppercase tracking-[1.9px] text-mint mb-6">
              Print Kiosks Without Apps
            </span>
            <h1 className="text-[50px] md:text-[90px] font-display leading-[0.80] uppercase w-full">
              Print From Your Phone
            </h1>
            <p className="mt-10 text-[16px] md:text-[20px] font-sans text-muted md:w-3/5 leading-relaxed">
              Upload your documents and print at a nearby kiosk — no app needed.
            </p>
          </div>

          <div className="w-full max-w-4xl">
            {/* Auth loading / error states */}
            {loading && (
              <div className="flex items-center justify-center py-20">
                <span className="w-8 h-8 border-2 border-mint border-t-transparent rounded-full animate-spin" />
                <span className="ml-4 font-mono text-[12px] uppercase tracking-[1.5px] text-muted">Establishing Secure Link...</span>
              </div>
            )}

            {error && !loading && (
              <div className="p-8 bg-slate/50 border border-ultraviolet rounded-[20px] text-center w-full shadow-[0px_0px_0px_1px_rgba(0,0,0,0.33)] max-w-lg mx-auto">
                <p className="text-ultraviolet font-mono font-bold uppercase tracking-[1.5px]">Failed to start session</p>
                <p className="text-muted text-sm mt-3 font-sans">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-8 px-6 py-3 border border-ultraviolet text-ultraviolet rounded-[30px] font-mono text-[12px] font-semibold uppercase tracking-[1.5px] hover:bg-ultraviolet hover:text-white transition-colors"
                >
                  Retry Connection
                </button>
              </div>
            )}

            {/* Main wizard — shown once auth is ready */}
            {!loading && !error && token && userId && (
              <PrintWizard token={token} userId={userId} />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full border-t border-slate py-8 mt-auto">
        <div className="max-w-[1280px] mx-auto px-6 text-center">
          <span className="font-mono text-[11px] uppercase text-muted tracking-[1.1px]">
            KAGAZ — YOUR FILES ARE ENCRYPTED AND DELETED AFTER 24 HOURS.
          </span>
        </div>
      </footer>
    </main>
  )
}
