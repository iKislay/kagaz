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
  { key: 'PENDING', label: 'Sent to Kiosk' },
  { key: 'PROCESSING', label: 'Processing' },
  { key: 'PRINTING', label: 'Printing' },
  { key: 'COMPLETED', label: 'Done!' },
]

function StatusProgressBar({ status }: { status: string | null }) {
  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === status)

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        {STATUS_STEPS.map((step, idx) => {
          const isCompleted = currentIndex > idx
          const isCurrent = currentIndex === idx
          const isPending = currentIndex < idx

          return (
            <div key={step.key} className="flex flex-col items-center flex-1">
              <div className="flex items-center w-full">
                {idx > 0 && (
                  <div
                    className={`flex-1 h-1 ${
                      isCompleted || isCurrent ? 'bg-blue-500' : 'bg-gray-200'
                    }`}
                  />
                )}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? 'bg-blue-500 text-white animate-pulse'
                      : isPending
                      ? 'bg-gray-200 text-gray-400'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {isCompleted ? '✓' : idx + 1}
                </div>
                {idx < STATUS_STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-1 ${isCompleted ? 'bg-blue-500' : 'bg-gray-200'}`}
                  />
                )}
              </div>
              <span
                className={`mt-2 text-xs text-center ${
                  isCurrent ? 'text-blue-600 font-semibold' : isCompleted ? 'text-green-600' : 'text-gray-400'
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

  // Step 1: Find nearby printers
  const handleFindPrinters = useCallback(() => {
    setLocationError(null)
    setLoadingPrinters(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        try {
          const res = await fetch(
            `/api/printers/nearby?lat=${latitude}&lng=${longitude}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          )
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Failed to fetch printers')
          setPrinters(data.printers || [])
        } catch (err) {
          setLocationError(err instanceof Error ? err.message : 'Failed to find printers')
        } finally {
          setLoadingPrinters(false)
        }
      },
      (err) => {
        setLocationError(`Location error: ${err.message}`)
        setLoadingPrinters(false)
      },
      { 
        enableHighAccuracy: false, 
        timeout: 30000, 
        maximumAge: 60000 
      }
    )
  }, [token])

  // Step 2: File drag and drop
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
      selectedFiles.forEach((file) => {
        formData.append('files', file, file.name)
      })

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

  // Step 3: Submit print job
  const handlePrint = useCallback(async () => {
    if (!selectedPrinter) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch('/api/jobs/print', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          printerId: selectedPrinter.printerId,
          settings,
        }),
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

  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* Step indicator */}
      <div className="flex items-center justify-center mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step === s
                  ? 'bg-blue-600 text-white'
                  : step > s
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {step > s ? '✓' : s}
            </div>
            {s < 4 && (
              <div
                className={`w-16 h-1 ${step > s ? 'bg-green-500' : 'bg-gray-200'}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Find Printer */}
      {step === 1 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Find a Printer</h2>
          <p className="text-gray-500 mb-6">
            We will find print kiosks near you. Make sure location access is enabled.
          </p>

          <button
            onClick={handleFindPrinters}
            disabled={loadingPrinters}
            className="w-full py-3 px-6 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loadingPrinters ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Finding printers...
              </>
            ) : (
              <>
                <span>Use My Location</span>
              </>
            )}
          </button>

          {locationError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {locationError}
            </div>
          )}

          {printers.length > 0 && (
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                {printers.length} printer{printers.length !== 1 ? 's' : ''} nearby
              </h3>
              {printers.map((printer) => (
                <div
                  key={printer.printerId}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${
                        printer.status === 'online' ? 'bg-green-500' : 'bg-red-400'
                      }`}
                    />
                    <div>
                      <div className="font-semibold text-gray-900">{printer.name}</div>
                      <div className="text-sm text-gray-500">{printer.address}</div>
                      {printer.city && (
                        <div className="text-xs text-gray-400">{printer.city}</div>
                      )}
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-blue-600">{printer.distanceText}</span>
                        {printer.capabilities.color && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                            Color
                          </span>
                        )}
                        {printer.capabilities.duplex && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
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
                    className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          )}

          {!loadingPrinters && printers.length === 0 && !locationError && (
            <p className="mt-6 text-center text-gray-400 text-sm">
              Click the button above to search for printers
            </p>
          )}
        </div>
      )}

      {/* Step 2: Upload Files */}
      {step === 2 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => setStep(1)}
              className="text-blue-600 hover:text-blue-700 text-sm"
            >
              Back
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-500">Printer: {selectedPrinter?.name}</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload Files</h2>
          <p className="text-gray-500 mb-6">PDF, JPG, or PNG — max 25MB each</p>

          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
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
            <div className="text-4xl mb-3">
              <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-gray-600 font-medium">
              Drag and drop files here, or click to browse
            </p>
            <p className="text-gray-400 text-sm mt-1">
              PDF, JPG, PNG, DOC, DOCX up to 25MB
            </p>
          </div>

          {/* File list */}
          {selectedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {selectedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{file.name}</div>
                      <div className="text-xs text-gray-500">{formatBytes(file.size)}</div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(idx)
                    }}
                    className="ml-3 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Print Settings */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Print Settings</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Copies</label>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Page Size</label>
                <select
                  value={settings.pageSize}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, pageSize: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                </select>
              </div>
            </div>

            <div className="flex gap-4 mt-4">
              {selectedPrinter?.capabilities.color && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, color: !prev.color }))
                    }
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      settings.color ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        settings.color ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </div>
                  <span className="text-sm text-gray-700">Color printing</span>
                </label>
              )}

              {selectedPrinter?.capabilities.duplex && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, duplex: !prev.duplex }))
                    }
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      settings.duplex ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        settings.duplex ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </div>
                  <span className="text-sm text-gray-700">Double-sided</span>
                </label>
              )}
            </div>
          </div>

          {uploadError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {uploadError}
            </div>
          )}

          <button
            onClick={handleUploadAndContinue}
            disabled={uploading || selectedFiles.length === 0}
            className="mt-6 w-full py-3 px-6 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </>
            ) : (
              'Upload & Continue'
            )}
          </button>
        </div>
      )}

      {/* Step 3: Confirm & Print */}
      {step === 3 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => setStep(2)}
              className="text-blue-600 hover:text-blue-700 text-sm"
            >
              Back
            </button>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirm & Print</h2>
          <p className="text-gray-500 mb-6">Review your order before sending to the printer.</p>

          <div className="space-y-4">
            {/* Printer info */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Printer
              </div>
              <div className="font-semibold text-gray-900">{selectedPrinter?.name}</div>
              <div className="text-sm text-gray-500">{selectedPrinter?.address}</div>
              <div className="text-sm text-blue-600">{selectedPrinter?.distanceText}</div>
            </div>

            {/* Files summary */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Files ({uploadedFiles.length})
              </div>
              {uploadedFiles.map((f, idx) => (
                <div key={idx} className="flex justify-between text-sm py-1">
                  <span className="text-gray-700 truncate">{f.filename}</span>
                  <span className="text-gray-400 ml-4 flex-shrink-0">{formatBytes(f.sizeBytes)}</span>
                </div>
              ))}
            </div>

            {/* Settings summary */}
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Print Settings
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-500">Copies</div>
                <div className="text-gray-900 font-medium">{settings.copies}</div>
                <div className="text-gray-500">Color</div>
                <div className="text-gray-900 font-medium">{settings.color ? 'Yes' : 'Black & White'}</div>
                <div className="text-gray-500">Double-sided</div>
                <div className="text-gray-900 font-medium">{settings.duplex ? 'Yes' : 'No'}</div>
                <div className="text-gray-500">Page Size</div>
                <div className="text-gray-900 font-medium">{settings.pageSize}</div>
              </div>
            </div>
          </div>

          {submitError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {submitError}
            </div>
          )}

          <button
            onClick={handlePrint}
            disabled={submitting}
            className="mt-6 w-full py-3 px-6 bg-green-600 text-white rounded-xl font-semibold text-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Sending to printer...
              </>
            ) : (
              'Print Now'
            )}
          </button>
        </div>
      )}

      {/* Step 4: Live Progress */}
      {step === 4 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {liveStatus === 'COMPLETED' ? 'Print Complete!' : 'Printing in Progress'}
          </h2>
          <p className="text-gray-500 mb-6">
            {liveStatus === 'COMPLETED'
              ? 'Your documents have been printed successfully.'
              : liveStatus === 'FAILED'
              ? 'Something went wrong with your print job.'
              : 'Your documents are being printed. Please wait...'}
          </p>

          {jobId && (
            <div className="mb-6 p-3 bg-gray-50 rounded-lg text-center">
              <span className="text-xs text-gray-400">Job ID: </span>
              <span className="text-xs font-mono text-gray-700">{jobId}</span>
            </div>
          )}

          <StatusProgressBar status={liveStatus} />

          {liveStatus === 'FAILED' && (liveError || 'Unknown error') && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              Error: {liveError || 'Unknown error'}
            </div>
          )}

          {liveStatus === 'COMPLETED' && (
            <div className="mt-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-green-700 font-semibold text-lg">Documents printed successfully!</p>
              <p className="text-gray-500 text-sm mt-1">
                Please collect your printout from {selectedPrinter?.name}.
              </p>
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
                className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
              >
                Print Again
              </button>
            </div>
          )}

          {!liveStatus && (
            <div className="flex items-center justify-center py-8">
              <span className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-gray-500">Connecting to printer...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
