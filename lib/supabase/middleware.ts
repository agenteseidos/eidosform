import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  hasInactivityTimeout,
  getInactivityTimeoutCookieOptions,
  getInactivityTimeoutValue,
  getLastActivityCookieName,
} from '@/lib/auth'

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If env vars are not set, just continue without auth
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and supabase.auth.getUser()
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data?.user ?? null
  } catch {
    // Auth check failed — treat as unauthenticated
    user = null
  }

  // Define protected routes
  const protectedRoutes = ['/dashboard', '/forms', '/admin']
  const isProtectedRoute = protectedRoutes.some(route => 
    request.nextUrl.pathname.startsWith(route)
  )

  // Check for inactivity timeout if user is authenticated
  if (user && isProtectedRoute) {
    const lastActivityCookie = request.cookies.get(getLastActivityCookieName())?.value
    const hasTimedOut = hasInactivityTimeout(lastActivityCookie)

    if (hasTimedOut) {
      // Clear session and redirect to login
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('message', 'Your session has expired due to inactivity. Please log in again.')
      return NextResponse.redirect(url, 307)
    }

    // Update last activity timestamp
    const cookieOptions = getInactivityTimeoutCookieOptions()
    supabaseResponse.cookies.set(
      cookieOptions.name,
      getInactivityTimeoutValue(),
      cookieOptions
    )
  }

  // Redirect to login if accessing protected route without auth
  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url, 307)
  }

  // Redirect to dashboard if already logged in and accessing login page
  if (request.nextUrl.pathname === '/login' && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

