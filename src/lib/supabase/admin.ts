import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * SERVER-ONLY Supabase client using the service-role (secret) key, which bypasses
 * Row Level Security. Used for exactly one thing: writing AI-authored community
 * replies, which the database deliberately forbids normal users from creating
 * (so nobody can forge "AgriDoctor AI" advice).
 *
 * Never import this from a client component. Returns null if the key is not set.
 */
let cached: SupabaseClient | null | undefined

export function getAdminClient(): SupabaseClient | null {
  if (typeof window !== 'undefined') throw new Error('admin client must never run in the browser')
  if (cached !== undefined) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  cached = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  return cached
}
