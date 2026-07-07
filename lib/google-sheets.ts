import { google } from 'googleapis'
import { logError } from '@/lib/logger'

const META_EVENTS_COLUMN = 'meta_events'
const UTM_COLUMNS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const RESPONSE_ID_COLUMN = 'response_id'
const STATUS_COLUMN = 'status'
const STATUS_COMPLETE = 'Completo'

/**
 * Parse the row index (1-based) from a Sheets API range like "Respostas!A47:H47".
 * Used to capture the row position after `values.append`, so the same row can
 * be updated later (partial → completo) without scanning the whole sheet.
 */
function parseRowIndexFromRange(range: string | null | undefined): number | null {
  if (!range) return null
  const match = range.match(/!\w+(\d+)(?::|$)/)
  return match ? parseInt(match[1], 10) : null
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!email || !key) {
    throw new Error('Google Sheets credentials not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)')
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  })
}

/**
 * Extracts the spreadsheet ID from a Google Sheets URL or raw ID.
 * Supports URLs like:
 *   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 *   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID
 * Also accepts a raw spreadsheet ID directly.
 */
export function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim()
  if (!trimmed) return null

  // Try to extract from URL
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (urlMatch) return urlMatch[1]

  // If it looks like a raw spreadsheet ID (alphanumeric, dashes, underscores, 20+ chars)
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed

  return null
}

/**
 * Connects to an existing Google Spreadsheet:
 *  - Validates access by reading metadata
 *  - Creates a "Respostas" sheet tab if it doesn't exist
 *  - Writes header row if the sheet is empty
 * Returns the spreadsheet title.
 */
export async function connectSpreadsheet(
  spreadsheetId: string,
  fieldLabels: string[]
): Promise<{ title: string }> {
  try {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  // 1. Read spreadsheet metadata (validates access)
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties',
  })

  const title = meta.data.properties?.title ?? 'Planilha sem título'
  const existingSheets = meta.data.sheets ?? []

  // 2. Check if "Respostas" tab exists
  const respostasSheet = existingSheets.find(
    (s) => s.properties?.title === 'Respostas'
  )

  if (!respostasSheet) {
    // Create the "Respostas" tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: 'Respostas' },
            },
          },
        ],
      },
    })
  }

  // 3. Check if header row exists
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Respostas!1:1',
  })

  const existingHeaders = headerRes.data.values?.[0] as string[] | undefined

  if (!existingHeaders || existingHeaders.length === 0) {
    // Header row: Data/Hora | response_id | status | field labels | meta_events | UTMs
    // response_id+status logo após Data/Hora pra ficar visível e filtrável.
    const headers = ['Data/Hora', RESPONSE_ID_COLUMN, STATUS_COLUMN, ...fieldLabels, META_EVENTS_COLUMN, ...UTM_COLUMNS]

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Respostas!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    })

    // Get the sheetId for formatting
    const updatedMeta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    })
    const respostasSheetId = updatedMeta.data.sheets?.find(
      (s) => s.properties?.title === 'Respostas'
    )?.properties?.sheetId

    if (respostasSheetId !== undefined) {
      // Bold the header row
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: respostasSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                  },
                },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
          ],
        },
      })
    }
  }

  return { title }
  } catch (error) {
    logError('[google-sheets] connectSpreadsheet error', error)
    throw error
  }
}

export interface UpsertResult {
  /** Row index (1-based) onde os dados foram gravados, ou null se houve erro. */
  rowIndex: number | null
}

interface UpsertOptions {
  spreadsheetId: string
  fieldLabels: string[]
  answers: Record<string, unknown>
  questionIdToLabel: Record<string, string>
  utmData: Record<string, string | null>
  responseId: string
  status: 'Parcial' | 'Completo'
  /** Se fornecido, atualiza a row existente nesse índice em vez de appendar. */
  rowIndex?: number | null
}

/**
 * Cria ou atualiza uma row de resposta na planilha. Quando rowIndex é fornecido,
 * faz UPDATE direto na linha (caso parcial → completo no mesmo lead). Senão,
 * appenda nova linha e retorna o índice — quem chamar deve persistir esse
 * número em `responses.sheets_row_index` pra updates futuros sem scan.
 */
export async function upsertSubmission(opts: UpsertOptions): Promise<UpsertResult> {
  const { spreadsheetId, fieldLabels, answers, questionIdToLabel, utmData, responseId, status, rowIndex } = opts
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    // 1) Lê headers atuais e migra se ainda não tem response_id/status (forms
    //    cuja planilha foi conectada antes desta feature).
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Respostas!1:1',
    })
    const existingHeaders: string[] = (headerRes.data.values?.[0] as string[]) ?? []

    const hasResponseId = existingHeaders.includes(RESPONSE_ID_COLUMN)
    const hasStatus = existingHeaders.includes(STATUS_COLUMN)
    const utmStartIndex = existingHeaders.findIndex((h) => UTM_COLUMNS.includes(h))
    const metaEventsIndex = existingHeaders.indexOf(META_EVENTS_COLUMN)

    // Onde terminam os campos de dados (antes do meta_events/UTMs)
    const endOfDataIdx = metaEventsIndex >= 0
      ? metaEventsIndex
      : (utmStartIndex >= 0 ? utmStartIndex : existingHeaders.length)
    // Slice após Data/Hora (col A), pulando response_id/status se já existem
    const dataStartIdx = 1 + (hasResponseId ? 1 : 0) + (hasStatus ? 1 : 0)
    const dataHeaders = existingHeaders.slice(dataStartIdx, endOfDataIdx)

    const newLabels = fieldLabels.filter((label) => !dataHeaders.includes(label))
    const needsHeaderUpdate = !hasResponseId || !hasStatus || newLabels.length > 0 || existingHeaders.length === 0

    if (needsHeaderUpdate) {
      const updatedHeaders = [
        'Data/Hora',
        RESPONSE_ID_COLUMN,
        STATUS_COLUMN,
        ...dataHeaders,
        ...newLabels,
        META_EVENTS_COLUMN,
        ...UTM_COLUMNS,
      ]
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Respostas!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [updatedHeaders] },
      })
    }

    // 2) Re-lê pra ter a ordem final exata
    const finalHeaderRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Respostas!1:1',
    })
    const finalHeaders: string[] = (finalHeaderRes.data.values?.[0] as string[]) ?? []

    // 3) Monta o row no formato final
    const labelToValue: Record<string, string> = {}
    for (const [questionId, value] of Object.entries(answers)) {
      const label = questionIdToLabel[questionId]
      if (label) labelToValue[label] = formatAnswerValue(value)
    }

    const now = new Date()
    const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const metaEventsValue = Array.isArray(answers.meta_events)
      ? (answers.meta_events as unknown[]).map(formatAnswerValue).join(', ')
      : ''

    const row = finalHeaders.map((header) => {
      if (header === 'Data/Hora') return timestamp
      if (header === RESPONSE_ID_COLUMN) return responseId
      if (header === STATUS_COLUMN) return status
      if (header === META_EVENTS_COLUMN) return metaEventsValue
      if (UTM_COLUMNS.includes(header)) return utmData[header] ?? ''
      return labelToValue[header] ?? ''
    })

    // 4) UPDATE direto se temos o índice; senão APPEND e captura o índice
    if (rowIndex && rowIndex > 1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Respostas!A${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
      })
      return { rowIndex }
    }

    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Respostas!A:A',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    })
    const updatedRange = appendRes.data.updates?.updatedRange ?? null
    return { rowIndex: parseRowIndexFromRange(updatedRange) }
  } catch (error) {
    logError('[google-sheets] upsertSubmission error', error)
    return { rowIndex: null }
  }
}

/**
 * @deprecated Use upsertSubmission. Mantida só pra não quebrar chamadores antigos.
 * Wrapper que vira upsertSubmission append (sempre cria nova row) ignorando
 * o índice retornado.
 */
export async function appendSubmission(
  spreadsheetId: string,
  fieldLabels: string[],
  answers: Record<string, unknown>,
  questionIdToLabel: Record<string, string>,
  utmData: Record<string, string | null>
): Promise<void> {
  await upsertSubmission({
    spreadsheetId,
    fieldLabels,
    answers,
    questionIdToLabel,
    utmData,
    responseId: '',
    status: STATUS_COMPLETE,
  })
}

function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
