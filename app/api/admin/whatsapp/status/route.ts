import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const WACLI = '/home/linuxbrew/.linuxbrew/bin/wacli'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  try {
    const { stdout } = await execFileAsync(WACLI, ['auth', 'status', '--json'], {
      timeout: 10_000,
    })

    const result = JSON.parse(stdout)

    if (!result.success) {
      return NextResponse.json({
        authenticated: false,
        connected: false,
        phoneNumber: null,
      })
    }

    const data = result.data ?? result
    return NextResponse.json({
      authenticated: data.authenticated ?? false,
      connected: data.connected ?? data.authenticated ?? false,
      phoneNumber: data.phoneNumber ?? data.phone ?? data.jid ?? null,
    })
  } catch (err: unknown) {
    console.error('WhatsApp status check failed:', err)
    return NextResponse.json(
      { authenticated: false, connected: false, phoneNumber: null },
      { status: 200 }
    )
  }
}
