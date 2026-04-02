function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function applyInlineFormatting(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

export function renderContentBlockHtml(text?: string | null): string {
  if (!text?.trim()) return ''

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(`<p>${paragraph.map(applyInlineFormatting).join('<br />')}</p>`)
    paragraph = []
  }

  const flushBullets = () => {
    if (bullets.length === 0) return
    blocks.push(`<ul>${bullets.map((item) => `<li>${applyInlineFormatting(item)}</li>`).join('')}</ul>`)
    bullets = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/)

    if (!line.trim()) {
      flushParagraph()
      flushBullets()
      continue
    }

    if (bulletMatch) {
      flushParagraph()
      bullets.push(bulletMatch[1])
      continue
    }

    flushBullets()
    paragraph.push(line)
  }

  flushParagraph()
  flushBullets()

  return blocks.join('')
}

export function getContentBlockPreview(text?: string | null, maxLength = 120): string {
  if (!text?.trim()) return 'Bloco de conteúdo vazio'

  const plain = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim()

  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain
}
