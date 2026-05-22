'use client'

import { useState, useCallback, useRef } from 'react'
import { useJobStatus } from '@/hooks/useJobStatus'

interface Printer {
  _id: string
  printerId: string
  name: string
  address: string
  city?: string
  status: string
  capabilities: {
    color: boolean
    duplex: boolean
    maxPageSize: string
  }
  distance: number
  distanceText: string
}

interface UploadedFile {
  url: string
  filename: string
  mimeType: string
  sizeBytes: number
}

interface PrintSettings {
  copies: number
  color: boolean
  duplex: boolean
  pageSize: string
}

type Step = 1 | 2 | 3 | 4

interface PrintWizardProps {
  token: string
  userId: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_STEPS = [
  { key: 'PENDING', label: 'SENT TO KIOSK' },
  { key: 'PROCESSING', label: 'PROCESSING' },
  { key: 'PRINTING', label: 'PRINTING' },
  { key: 'COMPLETED', label: 'DONE!' },
]

function StatusProgressBar({ status }: { status: string | null }) {
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === status)

  return (
    <div className="w-full mt-8">
      <div className="flex flex-col gap-6">
        {STATUS_STEPS.map((step, idx) => {
          const isCompleted = currentIndex > idx || status === 'COMPLETED'
          const isCurrent = currentIndex === idx && status !== 'COMPLETED'

          return (
            <div key={step.key} className="flex items-center w-full">
              <div
                className={`w-4 h-4 rounded-full border border-white flex items-center justify-center flex-shrink-0 ${
                  isCompleted
                    ? 'bg-mint border-transparent'
                    : isCurrent
                    ? 'bg-ultraviolet border-transparent animate-pulse'
                    : 'bg-transparent border-muted'
                }`}
              />
              <span
                className={`ml-4 font-mono text-[12px] uppercase tracking-[1.5px] ${
                  isCurrent ? 'text-white' : isCompleted ? 'text-mint' : 'text-muted'
                }`}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PrintWizard({ token, userId }: PrintWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [locationAttempt, setLocationAttempt] = useState(0)
  const [printers, setPrinters] = useState<Printer[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)

  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [settings, setSettings] = useState<PrintSettings>({
    copies: 1,
    color: false,
    duplex: false,
    pageSize: 'A4',
  })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const { status: liveStatus, error: liveError } = useJobStatus(jobId, userId)

  const fetchPrinters = useCallback(async (lat?: number, lng?: number) => {
    const url = lat != null && lng != null
      ? `/api/printers/nearby?lat=${lat}&lng=${lng}`
      : `/api/printers/nearby`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch printers')
    setPrinters(data.printers || [])
  }, [token])

  const handleFindPrinters = useCallback((isRetry = false) => {
    setLocationError(null)
    setLoadingPrinters(true)
    if (isRetry) setLocationAttempt((n) => n + 1)

    const tryGetPosition = (opts: PositionOptions): Promise<GeolocationPosition> =>
      new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, opts)
      )

    const run = async () => {
      let lat: number | undefined
      let lng: number | undefined

      // First try: fast, may use cached position
      try {
        const pos = await tryGetPosition({
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: isRetry ? 0 : 30000,
        })
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch {
        // Second try: force fresh, longer timeout
        try {
          const pos = await tryGetPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 })
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        } catch {
          // Location failed — fall back to showing all printers
        }
      }

      try {
        await fetchPrinters(lat, lng)
        if (lat == null) {
          setLocationError('Could not detect your location — showing all available printers.')
        }
      } catch (err) {
        setLocationError(err instanceof Error ? err.message : 'Failed to load printers')
      } finally {
        setLoadingPrinters(false)
      }
    }

    run()
  }, [token, fetchPrinters])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg',
       'application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(f.type)
    )
    setSelectedFiles((prev) => [...prev, ...droppedFiles])
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files)
      setSelectedFiles((prev) => [...prev, ...newFiles])
    }
  }, [])

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleUploadAndContinue = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setUploadError('Please select at least one file')
      return
    }
    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append('files', file, file.name))
      const res = await fetch('/api/jobs/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setUploadedFiles(data.files)
      setStep(3)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [selectedFiles, token])

  const handlePrint = useCallback(async () => {
    if (!selectedPrinter) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch('/api/jobs/print', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerId: selectedPrinter.printerId, settings }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit print job')

      setJobId(data.jobId)
      setStep(4)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to print')
    } finally {
      setSubmitting(false)
    }
  }, [selectedPrinter, settings, token])

  // Timestamps generator for StoryStream Rail
  const getTimestampStr = () => {
    const d = new Date()
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }

  return (
    <div className="w-full flex items-stretch min-h-[400px]">
      
      {/* LEFT RAIL (STORYSTREAM TIMELINE) */}
      <div className="w-12 md:w-24 flex flex-col items-center flex-shrink-0 pt-8 mr-2 md:mr-4">
        <div className="font-mono text-[11px] text-muted tracking-[1.1px] min-h-[60px] uppercase">
          {getTimestampStr()}
        </div>
        <div className="flex-1 w-[1px] bg-ultraviolet my-4 opacity-50 relative">
           <div className="absolute top-0 left-[-2px] w-[5px] h-[5px] bg-current rounded-full" />
           <div className="absolute bottom-0 left-[-2px] w-[5px] h-[5px] bg-current rounded-full" />
        </div>
        <div className="font-mono text-[11px] text-mint uppercase tracking-[1.8px] rotate-180" style={{ writingMode: 'vertical-rl' }}>
          STEP {step} OF 4
        </div>
      </div>

      {/* RIGHT CARDS */}
      <div className="flex-1 min-w-0 flex flex-col pt-4">

        {step === 1 && (
          <div className="bg-canvas border border-white rounded-[20px] p-6 md:p-10 w-full hover:border-[#3860be] transition-colors">
            <h2 className="text-[24px] md:text-[34px] font-sans font-bold text-white mb-2">Find a Printer</h2>
            <p className="text-muted mb-8 font-sans">
              We will find print kiosks near you. Make sure location access is enabled.
            </p>

            <button
              onClick={() => handleFindPrinters(false)}
              disabled={loadingPrinters}
              className="w-full py-4 px-6 bg-mint text-black rounded-[24px] font-mono text-[12px] font-semibold tracking-[1.5px] uppercase hover:bg-white/20 hover:text-white border outline-none border-transparent hover:border-[#c2c2c2] disabled:opacity-50 transition-all flex items-center justify-center gap-3"
            >
              {loadingPrinters ? (
                <>
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  LOCATING KIOSKS...
                </>
              ) : (
                'USE MY LOCATION'
              )}
            </button>

            {locationError && (
              <div className={`mt-6 p-4 rounded-[20px] border font-mono text-[12px] uppercase ${
                locationError.startsWith('Could not detect')
                  ? 'border-slate text-muted'
                  : 'border-ultraviolet text-ultraviolet'
              }`}>
                {locationError}
              </div>
            )}

            {printers.length > 0 && (
              <div className="mt-8 space-y-4">
                <h3 className="font-mono text-[12px] font-bold text-muted uppercase tracking-[1.8px] mb-4">
                  {printers.length} PRINTER{printers.length !== 1 ? 'S' : ''} NEARBY
                </h3>
                {printers.map((printer) => (
                  <div
                    key={printer.printerId}
                    className="flex flex-col md:flex-row items-start md:items-center justify-between p-5 border border-slate rounded-[20px] hover:border-mint bg-slate transition-colors gap-4"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`mt-1.5 w-3 h-3 rounded-full flex-shrink-0 ${
                          printer.status === 'online' ? 'bg-mint' : 'bg-red-500'
                        }`}
                      />
                      <div>
                        <div className="font-sans text-[20px] font-bold text-white leading-tight mb-1">{printer.name}</div>
                        <div className="font-sans text-[15px] text-muted">{printer.address}</div>
                        {printer.city && (
                          <div className="font-sans text-[13px] text-muted">{printer.city}</div>
                        )}
                        <div className="flex gap-2 mt-3 items-center">
                          <span className="font-mono text-[11px] text-deepblue uppercase tracking-[1.1px]">{printer.distanceText}</span>
                          {printer.capabilities.color && (
                            <span className="font-mono text-[11px] text-ultraviolet border border-ultraviolet px-3 py-1 rounded-[20px] uppercase tracking-[1.5px]">
                              Color
                            </span>
                          )}
                          {printer.capabilities.duplex && (
                            <span className="font-mono text-[11px] text-mint border border-mint px-3 py-1 rounded-[20px] uppercase tracking-[1.5px]">
                              Duplex
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedPrinter(printer)
                        setStep(2)
                      }}
                      disabled={printer.status !== 'online'}
                      className="w-full md:w-auto px-6 py-3 bg-white text-black rounded-[24px] font-mono text-[12px] font-bold uppercase tracking-[1.5px] hover:bg-mint transition-colors disabled:opacity-40"
                    >
                      SELECT
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="bg-canvas border border-white rounded-[20px] p-6 md:p-10 w-full hover:border-[#3860be] transition-colors relative">
            
            <div className="flex items-center justify-between mb-8">
              <div>
                <span className="font-mono text-[12px] uppercase text-mint tracking-[1.9px] block mb-2">
                  UPLOAD FILES
                </span>
                <h2 className="text-[24px] md:text-[34px] font-sans font-bold text-white m-0">Send to Printer</h2>
              </div>
              <button onClick={() => setStep(1)} className="text-muted hover:text-white font-mono text-[11px] uppercase tracking-[1.5px]">
                ← BACK
              </button>
            </div>

            <div className="mb-6 p-4 bg-slate rounded-[20px] border border-slate flex items-center justify-between">
               <span className="font-sans text-[15px] text-white">Target Kiosk: <span className="font-bold">{selectedPrinter?.name}</span></span>
            </div>

            {/* Drop zone */}
            <div
              className={`relative border border-dashed rounded-[20px] p-10 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-mint bg-[#131313]'
                  : 'border-[#949494] hover:border-white bg-[#131313]'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <p className="font-mono text-[12px] text-white uppercase tracking-[1.5px] mt-4">
                DRAG FILES HERE OR CLICK TO BROWSE
              </p>
              <p className="font-mono text-[11px] text-muted mt-2 tracking-[1.1px]">
                PDF, JPG, PNG, DOCX UP TO 25MB
              </p>
            </div>

            {/* File list */}
            {selectedFiles.length > 0 && (
              <div className="mt-6 space-y-3">
                {selectedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-4 bg-slate rounded-[20px] border border-transparent hover:border-ultraviolet transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="min-w-0">
                        <div className="font-sans text-[15px] text-white truncate">{file.name}</div>
                        <div className="font-mono text-[11px] text-muted tracking-[1.1px]">{formatBytes(file.size)}</div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(idx)
                      }}
                      className="ml-4 font-mono text-[11px] text-muted hover:text-[#5200ff] uppercase tracking-[1.5px] transition-colors flex-shrink-0"
                    >
                      REMOVE
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Print Settings */}
            <div className="mt-10 pt-8 border-t border-slate">
              <h3 className="font-mono text-[12px] font-bold text-mint uppercase tracking-[1.8px] mb-6">SETTINGS</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block font-mono text-[11px] text-muted uppercase tracking-[1.5px] mb-3">COPIES</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={settings.copies}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        copies: Math.max(1, Math.min(99, parseInt(e.target.value) || 1)),
                      }))
                    }
                    className="w-full px-4 py-3 bg-canvas border border-[#949494] rounded-[2px] text-white font-sans text-[15px] focus:outline-none focus:border-mint transition-colors"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] text-muted uppercase tracking-[1.5px] mb-3">PAGE SIZE</label>
                  <select
                    value={settings.pageSize}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, pageSize: e.target.value }))
                    }
                    className="w-full px-4 py-3 bg-canvas border border-[#949494] rounded-[2px] text-white font-sans text-[15px] focus:outline-none focus:border-mint transition-colors"
                  >
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                    <option value="Letter">Letter</option>
                    <option value="Legal">Legal</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-6 mt-8">
                {selectedPrinter?.capabilities.color && (
                  <label className="flex items-center gap-4 cursor-pointer group">
                    <div className={`relative w-12 h-6 rounded-full transition-colors border ${settings.color ? 'bg-mint border-transparent' : 'bg-transparent border-[#949494] group-hover:border-white'}`}>
                      <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full transition-transform ${settings.color ? 'translate-x-7 bg-black' : 'translate-x-1'}`} />
                    </div>
                    <span className="font-mono text-[11px] text-white uppercase tracking-[1.5px]">COLOR PRINTING</span>
                  </label>
                )}

                {selectedPrinter?.capabilities.duplex && (
                  <label className="flex items-center gap-4 cursor-pointer group">
                    <div className={`relative w-12 h-6 rounded-full transition-colors border ${settings.duplex ? 'bg-mint border-transparent' : 'bg-transparent border-[#949494] group-hover:border-white'}`}>
                      <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full transition-transform ${settings.duplex ? 'translate-x-7 bg-black' : 'translate-x-1'}`} />
                    </div>
                    <span className="font-mono text-[11px] text-white uppercase tracking-[1.5px]">DOUBLE-SIDED</span>
                  </label>
                )}
              </div>
            </div>

            {uploadError && (
              <div className="mt-8 p-4 border border-ultraviolet rounded-[20px] text-ultraviolet font-mono text-[12px] uppercase">
                {uploadError}
              </div>
            )}

            <button
              onClick={handleUploadAndContinue}
              disabled={uploading || selectedFiles.length === 0}
              className="mt-10 w-full py-4 px-6 bg-mint text-black rounded-[24px] font-mono text-[12px] font-semibold tracking-[1.5px] uppercase hover:bg-white/20 hover:text-white border outline-none border-transparent hover:border-[#c2c2c2] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3"
            >
              {uploading ? (
                <>
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  UPLOADING...
                </>
              ) : (
                'UPLOAD & CONTINUE'
              )}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="bg-canvas border border-white rounded-[20px] p-6 md:p-10 w-full hover:border-[#3860be] transition-colors relative">
            <div className="flex items-center justify-between mb-8">
              <div>
                <span className="font-mono text-[12px] uppercase text-mint tracking-[1.9px] block mb-2">
                  CONFIRM DETAILS
                </span>
                <h2 className="text-[24px] md:text-[34px] font-sans font-bold text-white m-0">Review Print Job</h2>
              </div>
              <button onClick={() => setStep(2)} className="text-muted hover:text-white font-mono text-[11px] uppercase tracking-[1.5px]">
                ← BACK
              </button>
            </div>

            <div className="space-y-6">
              {/* Printer info */}
              <div className="p-6 bg-slate rounded-[20px] border border-transparent">
                <div className="font-mono text-[12px] text-muted uppercase tracking-[1.5px] mb-2">
                  PRINTER
                </div>
                <div className="font-sans text-[20px] font-bold text-white mb-1">{selectedPrinter?.name}</div>
                <div className="font-sans text-[15px] text-muted">{selectedPrinter?.address}</div>
              </div>

              {/* Files summary */}
              <div className="p-6 bg-slate rounded-[20px] border border-transparent">
                <div className="font-mono text-[12px] text-muted uppercase tracking-[1.5px] mb-4">
                  FILES ({uploadedFiles.length})
                </div>
                {uploadedFiles.map((f, idx) => (
                  <div key={idx} className="flex justify-between font-sans text-[15px] py-2 border-b border-[#131313] last:border-0">
                    <span className="text-white truncate">{f.filename}</span>
                    <span className="text-mint font-mono text-[11px] tracking-[1.1px] ml-4 flex-shrink-0 mt-1">{formatBytes(f.sizeBytes)}</span>
                  </div>
                ))}
              </div>

              {/* Settings summary */}
              <div className="p-6 bg-slate rounded-[20px] border border-transparent">
                <div className="font-mono text-[12px] text-muted uppercase tracking-[1.5px] mb-4">
                  SETTINGS
                </div>
                <div className="grid grid-cols-2 gap-y-4 font-mono text-[11px] tracking-[1.1px] uppercase">
                  <div className="text-muted">COPIES</div>
                  <div className="text-white font-bold">{settings.copies}</div>
                  <div className="text-muted">COLOR</div>
                  <div className="text-white font-bold">{settings.color ? 'YES' : 'BLACK & WHITE'}</div>
                  <div className="text-muted">DOUBLE-SIDED</div>
                  <div className="text-white font-bold">{settings.duplex ? 'YES' : 'NO'}</div>
                  <div className="text-muted">PAGE SIZE</div>
                  <div className="text-white font-bold">{settings.pageSize}</div>
                </div>
              </div>
            </div>

            {submitError && (
              <div className="mt-8 p-4 border border-ultraviolet rounded-[20px] text-ultraviolet font-mono text-[12px] uppercase">
                {submitError}
              </div>
            )}

            <button
              onClick={handlePrint}
              disabled={submitting}
              className="mt-10 w-full py-4 px-6 bg-mint text-black rounded-[24px] font-mono text-[12px] font-semibold tracking-[1.5px] uppercase hover:bg-white/20 hover:text-white border outline-none border-transparent hover:border-[#c2c2c2] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  SENDING TO KIOSK...
                </>
              ) : (
                'PRINT NOW'
              )}
            </button>
          </div>
        )}

        {step === 4 && (
          <div className={`border rounded-[20px] p-6 md:p-10 w-full transition-colors relative ${liveStatus === 'COMPLETED' ? 'bg-mint border-transparent' : 'bg-canvas border-white hover:border-[#3860be]'}`}>
            
            <div className="flex flex-col mb-8">
              <span className={`font-mono text-[12px] uppercase tracking-[1.9px] block mb-2 ${liveStatus==='COMPLETED' ? 'text-black' : 'text-mint'}`}>
                {liveStatus === 'COMPLETED' ? 'STATUS: DONE' : 'STATUS: PRINTING'}
              </span>
              <h2 className={`text-[24px] md:text-[34px] font-sans font-bold m-0 ${liveStatus === 'COMPLETED' ? 'text-black' : 'text-white'}`}>
                 {liveStatus === 'COMPLETED' ? 'Print Complete!' : 'Job in Progress'}
              </h2>
            </div>
            
            <p className={`font-sans mb-8 ${liveStatus === 'COMPLETED' ? 'text-black/70' : 'text-muted'}`}>
               {liveStatus === 'COMPLETED'
                 ? 'Your documents have been printed successfully. You may securely exit.'
                 : liveStatus === 'FAILED'
                 ? 'Something went wrong with your print job.'
                 : 'Your documents are being printed. Please wait...'}
            </p>

            {jobId && (
               <div className={`mb-8 p-4 rounded-[20px] ${liveStatus === 'COMPLETED' ? 'bg-black/10' : 'bg-slate'}`}>
                 <span className={`font-mono text-[11px] uppercase tracking-[1.5px] ${liveStatus === 'COMPLETED' ? 'text-black/80' : 'text-muted'}`}>JOB ID: </span>
                 <span className={`font-mono text-[11px] uppercase tracking-[1.5px] ${liveStatus === 'COMPLETED' ? 'text-black' : 'text-white'}`}>{jobId}</span>
               </div>
            )}

            <StatusProgressBar status={liveStatus} />

            {liveStatus === 'FAILED' && (liveError || 'Unknown error') && (
              <div className="mt-8 p-4 border border-ultraviolet rounded-[20px] text-ultraviolet font-mono text-[12px] uppercase">
                ERROR: {liveError || 'Unknown error'}
              </div>
            )}

            {liveStatus === 'COMPLETED' && (
              <div className="mt-12 text-center">
                 <button
                    onClick={() => {
                       setStep(1)
                       setPrinters([])
                       setSelectedPrinter(null)
                       setSelectedFiles([])
                       setUploadedFiles([])
                       setJobId(null)
                       setSettings({ copies: 1, color: false, duplex: false, pageSize: 'A4' })
                    }}
                    className="w-full py-4 px-6 bg-black text-white rounded-[24px] font-mono text-[12px] font-semibold tracking-[1.5px] uppercase hover:bg-slate transition-all border outline-none border-transparent"
                 >
                    PRINT ANOTHER DOCUMENT
                 </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
