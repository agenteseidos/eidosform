import ExcelJS from 'exceljs'
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

export async function buildExcelExport(
  formTitle: string,
  questions: QuestionRow[],
  responses: ResponseRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EidosForm'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Respostas')

  const headers = [
    'ID',
    'Submetido em',
    'Completo',
    ...questions.map(q => q.title),
    'meta_events',
    ...UTM_KEYS,
  ]

  sheet.columns = headers.map((header, i) => ({
    header,
    key: String(i),
    width: Math.min(Math.max(header.length + 4, 12), 40),
  }))

  // Bold header row
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  }
  headerRow.commit()

  const questionIds = questions.map(q => q.id)

  for (const response of responses) {
    const answerMap = response.answers || {}
    const row: string[] = [
      response.id,
      new Date(response.submitted_at).toLocaleString('pt-BR'),
      response.completed ? 'Sim' : 'Não',
      ...questionIds.map(qid => cellValue(answerMap[qid])),
      (response.meta_events || []).join('; '),
      ...UTM_KEYS.map(k => response[k] ?? ''),
    ]
    sheet.addRow(row)
  }

  // Auto-fit columns based on data
  sheet.columns.forEach(col => {
    let maxLen = (col.header as string)?.length ?? 10
    col.eachCell?.({ includeEmpty: false }, cell => {
      const len = String(cell.value ?? '').length
      if (len > maxLen) maxLen = len
    })
    col.width = Math.min(maxLen + 2, 50)
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
