import type { SupabaseClient } from '@supabase/supabase-js'

const DIAGNOSIS_BUCKET = 'diagnosis-images'
const isUrl = (r: string) => /^https?:\/\//i.test(r)

/**
 * Turn stored diagnosis image references into displayable URLs, in ONE storage call.
 *  • New records store a storage path ("<userId>/<file>.jpg") → a fresh signed URL is created.
 *  • Older records stored a full (possibly expired) URL → returned unchanged.
 * Output is index-aligned with the input; unresolvable entries become null.
 */
export async function signImageRefs(supabase: SupabaseClient, refs: (string | null | undefined)[], expiresIn = 3600): Promise<(string | null)[]> {
  const paths = Array.from(new Set(refs.filter((r): r is string => !!r && !isUrl(r))))
  let signed = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase.storage.from(DIAGNOSIS_BUCKET).createSignedUrls(paths, expiresIn)
    for (const d of data ?? []) if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl)
  }
  return refs.map((r) => (!r ? null : isUrl(r) ? r : signed.get(r) ?? null))
}

/** All images of a single record, as displayable URLs. */
export async function resolveImageUrls(supabase: SupabaseClient, refs: string[] | null | undefined, expiresIn = 3600): Promise<string[]> {
  return (await signImageRefs(supabase, refs ?? [], expiresIn)).filter((u): u is string => !!u)
}
