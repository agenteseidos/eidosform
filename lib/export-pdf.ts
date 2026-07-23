import { jsPDF } from 'jspdf'
import { formatAnswerValue } from '@/lib/answer-format'
import { sanitizeCellValue } from '@/lib/sanitize-formula'

interface QuestionRow {
  id: string
  title: string
}

interface ResponseRow {
  id: string
  answers: Record<string, unknown>
  completed: boolean
  submitted_at: string
  meta_events: string[] | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

function cellValue(value: unknown): string {
  // Formatter de domínio: arquivo/endereço/calendly legíveis em vez de JSON cru
  // (auditoria Codex 2026-07-23). Sanitização anti-injeção preservada por fora.
  return sanitizeCellValue(formatAnswerValue(value, { sink: 'export' }))
}

const PT_TO_MM = 0.3528 // 1pt em mm

/**
 * Gera o PDF das respostas como um RELATÓRIO POR RESPOSTA (não tabela). Cada resposta
 * vira um bloco com os pares "Pergunta / Resposta" empilhados em largura total — legível
 * em qualquer formulário, inclusive os com muitas perguntas (onde uma tabela larga ficaria
 * ilegível) — e barato de gerar (sem o layout pesado de tabela em colunas estreitas).
 * Roda no NAVEGADOR (a montagem foi tirada do servidor p/ não estourar o timeout de função).
 */
export function buildPdfExport(
  formTitle: string,
  questions: QuestionRow[],
  responses: ResponseRow[],
  hideBranding = false
): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 15
  const marginTop = 18
  const marginBottom = 16
  const contentW = pageW - marginX * 2
  let y = marginTop

  const lineH = (fontSize: number, factor = 1.15) => fontSize * PT_TO_MM * factor

  // Garante espaço vertical; se não couber, abre nova página.
  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - marginBottom) {
      doc.addPage()
      y = marginTop
    }
  }

  // Escreve um parágrafo com quebra de linha automática (full-width).
  const writeParagraph = (
    text: string,
    fontSize: number,
    style: 'bold' | 'normal',
    color: [number, number, number]
  ) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(fontSize)
    doc.setTextColor(color[0], color[1], color[2])
    const lines = doc.splitTextToSize(text || '—', contentW) as string[]
    const lh = lineH(fontSize)
    for (const line of lines) {
      ensureSpace(lh)
      doc.text(line, marginX, y)
      y += lh
    }
  }

  // ── Cabeçalho do documento ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(17, 24, 39)
  doc.text(formTitle || 'Formulário', marginX, y)
  y += lineH(16, 1.25)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(120, 120, 120)
  doc.text(
    `Exportado em ${new Date().toLocaleString('pt-BR')}  ·  ${responses.length} resposta${responses.length === 1 ? '' : 's'}`,
    marginX,
    y
  )
  y += lineH(9.5) + 4

  if (responses.length === 0) {
    writeParagraph('Nenhuma resposta para exportar.', 10, 'normal', [120, 120, 120])
  }

  // ── Um bloco por resposta ──
  responses.forEach((response, idx) => {
    const headerH = 7
    // Mantém o cabeçalho da resposta junto com ao menos o início do conteúdo.
    ensureSpace(headerH + lineH(9.5) * 2 + 6)

    // Barra-título da resposta.
    doc.setFillColor(16, 185, 129) // emerald-500
    doc.rect(marginX, y, contentW, headerH, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    const date = new Date(response.submitted_at).toLocaleString('pt-BR')
    const status = response.completed ? 'Completo' : 'Incompleto'
    doc.text(`Resposta ${idx + 1}  ·  ${date}  ·  ${status}`, marginX + 3, y + headerH - 2.3)
    y += headerH + 4

    // Pares pergunta / resposta.
    const answerMap = response.answers || {}
    questions.forEach(q => {
      const answer = cellValue(answerMap[q.id]) || '—'
      // Evita "pergunta órfã" no rodapé: reserva pergunta + 1 linha de resposta.
      ensureSpace(lineH(9.5) * 2 + 2)
      writeParagraph(q.title, 9.5, 'bold', [55, 65, 81]) // slate-700
      y += 0.5
      writeParagraph(answer, 9.5, 'normal', [17, 24, 39]) // slate-900
      y += 2.5
    })

    // Linha compacta de metadados (meta_events + UTMs), só se houver.
    const metaParts: string[] = []
    if (response.meta_events?.length) metaParts.push(`eventos: ${response.meta_events.join(', ')}`)
    for (const k of UTM_KEYS) {
      if (response[k]) metaParts.push(`${k}: ${response[k]}`)
    }
    if (metaParts.length) {
      y += 0.5
      writeParagraph(metaParts.join('   ·   '), 7.5, 'normal', [150, 150, 150])
    }

    y += 7 // respiro antes da próxima resposta
  })

  // ── Rodapé em todas as páginas (numeração + marca) ──
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const w = doc.internal.pageSize.getWidth()
    const h = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(`Página ${p} de ${totalPages}`, w / 2, h - 8, { align: 'center' })
    if (!hideBranding) {
      doc.text('EidosForm', marginX, h - 8)
    }
  }

  return new Uint8Array(doc.output('arraybuffer'))
}
