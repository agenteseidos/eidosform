import { SupabaseClient } from '@supabase/supabase-js'

// 30 minutes inactivity timeout
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000

// Cookie name for tracking last activity
const LAST_ACTIVITY_COOKIE_NAME = '__lastActivity'

/**
 * Check if user session has timed out due to inactivity
 * Returns true if timeout occurred, false otherwise
 */
export function hasInactivityTimeout(
  lastActivityCookie?: string
): boolean {
  if (!lastActivityCookie) {
    return false
  }

  try {
    const lastActivityTime = parseInt(lastActivityCookie, 10)
    if (isNaN(lastActivityTime)) {
      return false
    }

    const now = Date.now()
    const elapsed = now - lastActivityTime

    return elapsed > INACTIVITY_TIMEOUT_MS
  } catch {
    return false
  }
}

/**
 * Get the timestamp for the inactivity timeout cookie value
 */
export function getInactivityTimeoutValue(): string {
  return Date.now().toString()
}

/**
 * Get inactivity timeout configuration for cookies
 */
export function getInactivityTimeoutCookieOptions() {
  return {
    name: LAST_ACTIVITY_COOKIE_NAME,
    maxAge: INACTIVITY_TIMEOUT_MS / 1000, // Convert to seconds
    httpOnly: false, // Need to be accessible from client for updates
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
}

/**
 * Get the last activity cookie name
 */
export function getLastActivityCookieName(): string {
  return LAST_ACTIVITY_COOKIE_NAME
}

/**
 * Get inactivity timeout duration in milliseconds
 */
export function getInactivityTimeoutDuration(): number {
  return INACTIVITY_TIMEOUT_MS
}

/**
 * Clear user session by signing out with Supabase
 */
export async function clearAuthSession(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut()
  } catch (error) {
    console.error('Error clearing auth session:', error)
  }
}
