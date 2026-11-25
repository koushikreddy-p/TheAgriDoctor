'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { UploadCloud, X, Loader2, Sprout, AlertCircle, CheckCircle2, ChevronDown, ImageDown, ShieldCheck, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { compressImage, uploadDiagnosisImage } from '@/lib/upload'
import { createClient } from '@/lib/supabase/client'

const CROP_OPTIONS = [
  'Rice', 'Wheat', 'Tomato', 'Potato', 'Sugarcane',
  'Cotton', 'Maize', 'Chili', 'Onion', 'Soybean',
  'Groundnut', 'Mango', 'Banana', 'Grapes', 'Other'
]

type UIState = 'idle' | 'compressing' | 'uploading' | 'analyzing' | 'done' | 'error'

const STEPS: { key: UIState; label: string; icon: React.ElementType }[] = [
  { key: 'compressing', label: 'Optimising photos', icon: ImageDown },
  { key: 'uploading', label: 'Uploading securely', icon: ShieldCheck },
  { key: 'analyzing', label: 'AI analysis', icon: Cpu },
]

function ProgressCard({ state, seconds }: { state: UIState; seconds: number }) {
  const order = ['compressing', 'uploading', 'analyzing', 'done']
  const current = order.indexOf(state)
  return (
    <Card className="border-emerald-200" aria-live="polite">
      <CardContent className="p-5">
        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => {
            const done = current > i
            const active = current === i
            const Icon = s.icon
            return (
              <li key={s.key} className="flex flex-col items-center text-center gap-1.5">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center ${done ? 'bg-emerald-600 text-white' : active ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300' : 'bg-slate-100 text-slate-400'}`}>
                  {done ? <CheckCircle2 className="w-5 h-5" /> : active ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-4 h-4" />}
                </span>
                <span className={`text-xs font-medium ${done || active ? 'text-slate-800' : 'text-slate-400'}`}>{s.label}</span>
              </li>
            )
          })}
        </ol>
        <p className="text-center text-xs text-slate-500 mt-4">
          {state === 'done' ? 'Report ready — opening it now…' : `Working… ${seconds}s`}
        </p>
        {state === 'analyzing' && seconds >= 10 && (
          <p className="text-center text-xs text-amber-700 mt-1">
            Taking longer than usual — AgriDoctor automatically tries backup AI models. This can take up to a minute.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default function DiagnosePage() {
  const router = useRouter()
  const supabase = createClient()

  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [cropType, setCropType] = useState('')
  const [uiState, setUiState] = useState<UIState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: File[]) => {
    const imageFiles = newFiles.filter(f => f.type.startsWith('image/'))
    const combined = [...files, ...imageFiles].slice(0, 5)
    setFiles(combined)
    const newPreviews = combined.map(f => URL.createObjectURL(f))
    setPreviews(newPreviews)
  }, [files])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }, [addFiles])

  const handleDiagnose = async () => {
    if (!files.length || !cropType) return

    setErrorMsg('')
    setUiState('compressing')

    try {
      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        router.push('/login?redirect=/diagnose')
        return
      }
      const user = { id: authUser.id }

      // Compress photos in the browser (≈1280 px JPEG) — faster uploads and stays under request limits
      // One at a time: keeps memory low on budget phones (12 MP photos decode to ~48 MB each)
      const compressed: { blob: Blob; dataUrl: string }[] = []
      for (const f of files) {
        try {
          compressed.push(await compressImage(f))
        } catch {
          throw new Error(`Could not read "${f.name}". Please use a JPG or PNG photo.`)
        }
      }
      const base64Array = compressed.map(c => c.dataUrl)

      // Store the compressed images in Supabase Storage (non-fatal if it fails)
      setUiState('uploading')
      let imagePaths: string[] = []
      try {
        imagePaths = await Promise.all(compressed.map(c => uploadDiagnosisImage(c.blob, user.id)))
      } catch (uploadErr) {
        console.warn('Storage upload failed, proceeding without stored images:', uploadErr)
      }

      setUiState('analyzing')

      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64Array: base64Array, imagePaths, cropType }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'AI analysis failed')
      }

      setUiState('done')

      // Redirect to result page
      if (json.diagnosisId) {
        router.push(`/diagnose/${json.diagnosisId}`)
      } else {
        // Store result in sessionStorage as fallback if DB save failed
        sessionStorage.setItem('pending_diagnosis', JSON.stringify({ report: json.report, cropType }))
        router.push('/diagnose/pending')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error'
      setErrorMsg(msg)
      setUiState('error')
    }
  }

  const busy = uiState === 'compressing' || uiState === 'uploading' || uiState === 'analyzing' || uiState === 'done'
  const isDisabled = !files.length || !cropType || busy

  // Elapsed-time counter while working
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!busy) return
    setSeconds(0)
    const started = Date.now()
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">AI Crop Disease Detection</h1>
        <p className="text-slate-500 mt-1">Upload clear photos of your crop and get instant expert analysis powered by AI.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 1 — Select Your Crop</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <select
              id="crop-select"
              value={cropType}
              onChange={e => setCropType(e.target.value)}
              className="w-full appearance-none h-11 rounded-lg border border-slate-200 bg-white px-4 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all cursor-pointer"
            >
              <option value="" disabled>Select a crop type...</option>
              {CROP_OPTIONS.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 2 — Upload Crop Images</CardTitle>
          <CardDescription>Upload 1–5 clear photos of the affected area. More photos = better accuracy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 cursor-pointer transition-all select-none
              ${isDragging
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
              }
            `}
          >
            <UploadCloud className={`w-10 h-10 mb-3 ${isDragging ? 'text-emerald-500' : 'text-slate-300'}`} />
            <p className="text-sm font-medium text-slate-600">
              {isDragging ? 'Drop images here' : 'Drag & drop images or click to browse'}
            </p>
            <p className="text-xs text-slate-400 mt-1">JPG or PNG · up to 5 photos · resized automatically for fast upload</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={e => addFiles(Array.from(e.target.files ?? []))}
            />
          </div>

          {/* Image previews */}
          {previews.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {previews.map((src, idx) => (
                <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200">
                  <Image
                    src={src}
                    alt={`Preview ${idx + 1}`}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  <button
                    onClick={e => { e.stopPropagation(); removeFile(idx) }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white px-1 rounded">
                    {idx + 1}
                  </div>
                </div>
              ))}
              {previews.length < 5 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-slate-200 hover:border-emerald-300 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors"
                >
                  <UploadCloud className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error message */}
      {uiState === 'error' && (
        <div className="flex items-start space-x-3 p-4 rounded-xl border border-red-200 bg-red-50">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">Analysis Failed</p>
            <p className="text-sm text-red-700 mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {busy && <ProgressCard state={uiState} seconds={seconds} />}

      {/* Submit */}
      <Button
        onClick={handleDiagnose}
        disabled={isDisabled}
        className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {(uiState === 'compressing' || uiState === 'uploading' || uiState === 'analyzing') && (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Analysing your crop…
          </>
        )}
        {uiState === 'done' && (
          <>
            <CheckCircle2 className="w-5 h-5 mr-2" />
            Done! Redirecting…
          </>
        )}
        {(uiState === 'idle' || uiState === 'error') && (
          <>
            <Sprout className="w-5 h-5 mr-2" />
            Detect Disease
          </>
        )}
      </Button>

      {/* Tips */}
      <Card className="bg-amber-50/60 border-amber-100">
        <CardContent className="p-4">
          <p className="text-xs font-semibold text-amber-800 mb-2 uppercase tracking-wide">📷 Tips for Best Results</p>
          <ul className="space-y-1">
            {[
              'Take photos in natural daylight',
              'Focus on the most affected area (e.g., spots, discoloration)',
              'Include both healthy and diseased parts in separate photos',
              'Avoid blurry or dark images',
            ].map((tip, i) => (
              <li key={i} className="text-xs text-amber-700 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-2 flex-shrink-0" />
                {tip}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
