import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const WACLI = '/home/linuxbrew/.linuxbrew/bin/wacli'

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  try {
    const { stdout } = await execFileAsync(WACLI, ['auth', 'logout', '--json'], {
      timeout: 15_000,
    })

    const result = JSON.parse(stdout)

    if (result.success === false) {
      return NextResponse.json(
        { error: 'Disconnect failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('WhatsApp disconnect failed:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
