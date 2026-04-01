import { google } from 'googleapis'

const UTM_COLUMNS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

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
    // Write header row: Data/Hora | field labels | UTM columns
    const headers = ['Data/Hora', ...fieldLabels, ...UTM_COLUMNS]

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
}

/**
 * Appends a submission row to an existing spreadsheet.
 * Dynamically adds new field columns before the UTM columns if needed.
 */
export async function appendSubmission(
  spreadsheetId: string,
  fieldLabels: string[],
  answers: Record<string, unknown>,
  questionIdToLabel: Record<string, string>,
  utmData: Record<string, string | null>
): Promise<void> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  // Read existing headers
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Respostas!1:1',
  })

  const existingHeaders: string[] = (headerRes.data.values?.[0] as string[]) ?? []

  // Find where UTM columns start (or end of headers)
  const utmStartIndex = existingHeaders.findIndex((h) => UTM_COLUMNS.includes(h))
  const dataHeaders = utmStartIndex >= 0
    ? existingHeaders.slice(1, utmStartIndex) // skip Data/Hora, stop before UTMs
    : existingHeaders.slice(1) // skip Data/Hora

  // Check for new field labels that don't exist yet
  const newLabels = fieldLabels.filter((label) => !dataHeaders.includes(label))

  if (newLabels.length > 0) {
    // Rebuild full header row: Data/Hora | existing data headers | new labels | UTMs
    const updatedHeaders = ['Data/Hora', ...dataHeaders, ...newLabels, ...UTM_COLUMNS]

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Respostas!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [updatedHeaders] },
    })
  }

  // Re-read headers after potential update to get final column order
  const finalHeaderRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Respostas!1:1',
  })
  const finalHeaders: string[] = (finalHeaderRes.data.values?.[0] as string[]) ?? []

  // Build a label-to-value map from answers
  const labelToValue: Record<string, string> = {}
  for (const [questionId, value] of Object.entries(answers)) {
    const label = questionIdToLabel[questionId]
    if (label) {
      labelToValue[label] = formatAnswerValue(value)
    }
  }

  // Build the row matching final headers
  const now = new Date()
  const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  const row = finalHeaders.map((header) => {
    if (header === 'Data/Hora') return timestamp
    if (UTM_COLUMNS.includes(header)) return utmData[header] ?? ''
    return labelToValue[header] ?? ''
  })

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Respostas!A:A',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
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
