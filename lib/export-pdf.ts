import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

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
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join('; ')
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function buildPdfExport(
  formTitle: string,
  questions: QuestionRow[],
  responses: ResponseRow[],
  hideBranding = false
): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Title
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(formTitle || 'Formulário', 14, 20)

  // Subtitle
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120)
  doc.text(
    `Exportado em ${new Date().toLocaleString('pt-BR')} · ${responses.length} respostas`,
    14,
    27
  )
  doc.setTextColor(0)

  // Build table data
  const headers = [
    'ID',
    'Submetido em',
    'Completo',
    ...questions.map(q => q.title),
    'meta_events',
    ...UTM_KEYS,
  ]

  const questionIds = questions.map(q => q.id)

  const body: string[][] = responses.map(response => {
    const answerMap = response.answers || {}
    return [
      response.id.slice(0, 8),
      new Date(response.submitted_at).toLocaleString('pt-BR'),
      response.completed ? 'Sim' : 'Não',
      ...questionIds.map(qid => cellValue(answerMap[qid])),
      (response.meta_events || []).join('; '),
      ...UTM_KEYS.map(k => response[k] ?? ''),
    ]
  })

  autoTable(doc, {
    head: [headers],
    body,
    startY: 33,
    styles: {
      fontSize: 7,
      cellPadding: 2,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [16, 185, 129], // emerald-500
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250],
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Footer with page number
      const pageCount = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(
        `Página ${data.pageNumber} de ${pageCount}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'center' }
      )
      // Branding (hide for white-label plans)
      if (!hideBranding) {
        doc.text(
          'EidosForm',
          14,
          doc.internal.pageSize.getHeight() - 8
        )
      }
    },
  })

  return new Uint8Array(doc.output('arraybuffer'))
}
