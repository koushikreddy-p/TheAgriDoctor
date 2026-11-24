import { createClient } from '@/lib/supabase/client'

export const DIAGNOSIS_BUCKET = 'diagnosis-images'

/**
 * Downscale + re-encode a photo in the browser before upload / AI analysis.
 * A 12 MP phone photo (3–5 MB) becomes a ~150–400 KB JPEG at 1280 px, which is
 * plenty for disease detection, keeps the request under hosting body limits,
 * and makes the upload much faster on rural mobile networks.
 */
export async function compressImage(
  file: File,
  maxDim = 1280,
  quality = 0.82
): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), 'image/jpeg', quality)
  )
  const dataUrl = await blobToDataUrl(blob)
  return { blob, dataUrl }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Uploads an image to Supabase Storage under the user's own folder.
 * Returns the storage PATH (not a signed URL): signed URLs expire, so the
 * path is stored in the database and a fresh signed URL is created whenever
 * the image is displayed (see resolveImageUrls).
 */
export async function uploadDiagnosisImage(image: Blob, userId: string): Promise<string> {
  const supabase = createClient()
  const ext = image.type === 'image/png' ? 'png' : 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage.from(DIAGNOSIS_BUCKET).upload(path, image, {
    cacheControl: '3600',
    upsert: false,
    contentType: image.type || 'image/jpeg',
  })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return path
}
