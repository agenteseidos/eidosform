import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PNG } from 'pngjs'

const execFileAsync = promisify(execFile)

const WACLI = '/home/linuxbrew/.linuxbrew/bin/wacli'
const QR_TIMEOUT_S = 15
const RATE_LIMIT_MS = 60_000

let lastQrTime = 0

/**
 * Parse Unicode block-character QR art from wacli into a 2D boolean matrix.
 *
 * Each row of QR output uses pairs of half-block characters stacked vertically:
 *   █ = both top+bottom filled
 *   ▀ = top filled, bottom empty
 *   ▄ = top empty, bottom filled
 *   (space) = both empty
 *
 * Two consecutive character rows encode one row of QR modules (2 pixels tall per char row).
 */
function parseQrAscii(ascii: string): boolean[][] | null {
  const lines = ascii.split('\n').filter((l) => l.trim().length > 0)

  // Find QR content lines (those containing block characters)
  const qrLines = lines.filter((l) => /[█▀▄ ]{10,}/.test(l))
  if (qrLines.length < 2) return null

  // Strip the border frame (outermost █ rows and cols)
  // Remove lines that are all █ (border)
  const contentLines = qrLines.filter((l) => !/^█+$/.test(l.trim()))
  if (contentLines.length === 0) return null

  // Remove leading/trailing █ border columns
  const stripped = contentLines.map((l) => {
    let start = 0
    let end = l.length
    while (start < end && l[start] === '█') start++
    while (end > start && l[end - 1] === '█') end--
    return l.slice(start, end)
  })

  // Calculate QR module dimensions
  const cols = stripped[0]?.length ?? 0
  if (cols === 0) return null

  // Each character pair (2 consecutive lines) = 1 row of QR modules (2 pixels)
  // Each character column = 1 QR module (1 pixel wide)
  const modules: boolean[][] = []

  for (let row = 0; row < stripped.length; row++) {
    const line = stripped[row]
    const moduleRow: boolean[] = []

    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      const isFilled = ch === '█' || ch === '▀' || ch === '▄'
      moduleRow.push(isFilled)
    }

    if (moduleRow.length > 0) {
      modules.push(moduleRow)
    }
  }

  return modules.length > 0 ? modules : null
}

function qrToPng(modules: boolean[][], scale = 8, margin = 4): Buffer {
  const size = modules.length
  const imgSize = size * scale + margin * 2 * scale

  const png = new PNG({ width: imgSize, height: imgSize })

  // Fill white
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0xff // R
    png.data[i + 1] = 0xff // G
    png.data[i + 2] = 0xff // B
    png.data[i + 3] = 0xff // A
  }

  // Draw modules
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < modules[row].length; col++) {
      if (modules[row][col]) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = margin * scale + col * scale + dx
            const y = margin * scale + row * scale + dy
            const idx = (y * imgSize + x) << 2
            png.data[idx] = 0x00
            png.data[idx + 1] = 0x00
            png.data[idx + 2] = 0x00
            png.data[idx + 3] = 0xff
          }
        }
      }
    }
  }

  return PNG.sync.write(png)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response

  // Rate limit
  const now = Date.now()
  const remaining = RATE_LIMIT_MS - (now - lastQrTime)
  if (remaining > 0) {
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(remaining / 1000)} seconds.` },
      { status: 429 }
    )
  }
  lastQrTime = now

  try {
    const { stdout } = await execFileAsync(
      WACLI,
      ['auth', '--json'],
      { timeout: QR_TIMEOUT_S * 1000, maxBuffer: 1024 * 1024 }
    )

    const modules = parseQrAscii(stdout)
    if (!modules) {
      return NextResponse.json(
        { error: 'Failed to generate QR code' },
        { status: 500 }
      )
    }

    const pngBuffer = qrToPng(modules)

    return new Response(new Uint8Array(pngBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err: unknown) {
    console.error('WhatsApp QR generation failed:', err)
    return NextResponse.json(
      { error: 'Failed to generate QR code' },
      { status: 500 }
    )
  }
}
