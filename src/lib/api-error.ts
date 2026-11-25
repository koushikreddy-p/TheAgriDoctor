import { NextResponse } from 'next/server'

/**
 * Log the real error on the server and return a safe, generic message to the browser.
 * Database / upstream error text can reveal table names, policies or request URLs
 * (which may contain API keys), so it never leaves the server.
 */
export function serverError(tag: string, err: unknown, message = 'Something went wrong. Please try again.', status = 500) {
  const detail = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  console.error(`[${tag}]`, detail)
  return NextResponse.json({ error: message }, { status })
}
