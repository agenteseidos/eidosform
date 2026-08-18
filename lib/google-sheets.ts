import { google } from 'googleapis'
import { formatAnswerValue as formatDomainAnswer } from '@/lib/answer-format'
import { logError } from '@/lib/logger'

const META_EVENTS_COLUMN = 'meta_events'
const UTM_COLUMNS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const RESPONSE_ID_COLUMN = 'response_id'
const STATUS_COLUMN = 'status'
const STATUS_COMPLETE = 'Completo'
// Campos ocultos de identidade (url_params) com coluna fixa logo após Data/Hora
// (B/C/D). Planilhas conectadas ANTES desta feature não ganham as colunas
// automaticamente — re-vincular/aba nova (decisão do briefing campos-ocultos §13.9).
const IDENTITY_COLUMNS = ['nome', 'email', 'telefone'] as const

/**
 * Parse the row index (1-based) from a Sheets API range like "Respostas!A47:H47".
 * Used to capture the row position after `values.append`, so the same row can
 * be updated later (partial → completo) without scanning the whole sheet.
 */
// Índice de coluna (0-based) → letra A1 (A..Z, AA..AZ, ...)
function columnLetter(index: number): string {
  let n = index + 1
  let letter = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

export function parseRowIndexFromRange(range: string | null | undefined): number | null {
  if (!range) return null
  // Pega a célula inicial APÓS o nome da aba ("Respostas!A11:Q11" → 11).
  // ⚠️ A regex antiga (/!\w+(\d+)/) tinha \w+ GULOSO: "A11" casava \w+="A1" e
  // capturava só "1" — TODA linha ≥10 era gravada truncada em sheets_row_index,
  // e o update seguinte escrevia na LINHA ERRADA da planilha (bug pego em
  // produção 2026-07-08, sheets_row 1/2 para appends nas linhas 11/12).
  const cell = range.split('!').pop() ?? ''
  const match = cell.match(/^([A-Za-z]+)(\d+)/)
  return match ? parseInt(match[2], 10) : null
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
    // Header row: Data/Hora | nome | email | telefone | response_id | status | field labels | meta_events | UTMs
    // Identidade (campos ocultos da URL) em B/C/D pra leitura rápida da planilha.
    const headers = ['Data/Hora', ...IDENTITY_COLUMNS, RESPONSE_ID_COLUMN, STATUS_COLUMN, ...fieldLabels, META_EVENTS_COLUMN, ...UTM_COLUMNS]

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
  /** Campos ocultos da URL (hidden fields) — preenche as colunas de identidade. */
  urlParams?: Record<string, string> | null
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
/**
 * Monta a linha 1 da planilha (auditoria 2026-08, lote 3 · L3-5).
 *
 * O DEFEITO que isto corrige: a versão anterior RECALCULAVA a ordem inteira das colunas e
 * reescrevia só a linha 1 — sem mexer nas linhas de dados abaixo. Sempre que uma pergunta nova
 * era adicionada ao formulário, ela era INSERIDA no meio (antes de `meta_events` e das UTMs),
 * empurrando essas colunas uma casa para a direita **apenas no cabeçalho**. Todas as respostas
 * já gravadas passavam a exibir o valor de uma coluna sob o título de outra: o histórico inteiro
 * do cliente ficava desalinhado, em silêncio, por uma edição banal do formulário.
 *
 * A REGRA AGORA É: **só acrescentar, nunca reordenar.** Numa planilha que já tem dados, o
 * cabeçalho existente é tratado como imutável — coluna nova entra no FIM, mesmo que isso deixe
 * uma pergunta depois das UTMs. A ordem fica menos bonita; o histórico fica correto. Não há
 * escolha entre as duas: reordenar o cabeçalho sem reescrever milhares de linhas de dados
 * corrompe a planilha, e reescrever os dados exigiria reprocessar respostas que talvez nem
 * existam mais no banco.
 *
 * A montagem da linha de dados (`finalHeaders.map(...)`) casa por NOME de coluna, não por
 * posição — por isso acrescentar no fim funciona sem nenhuma outra mudança.
 *
 * Planilha VAZIA é o único caso em que a ordem canônica bonita é aplicada: não há histórico
 * para desalinhar.
 */
export function computeSheetHeaders(
  existingHeaders: string[],
  fieldLabels: string[]
): { headers: string[]; needsUpdate: boolean } {
  if (existingHeaders.length === 0) {
    return {
      headers: dedup([
        'Data/Hora',
        ...IDENTITY_COLUMNS,
        RESPONSE_ID_COLUMN,
        STATUS_COLUMN,
        ...fieldLabels,
        META_EVENTS_COLUMN,
        ...UTM_COLUMNS,
      ]),
      needsUpdate: true,
    }
  }

  const jaExiste = new Set(existingHeaders)
  const acrescentar: string[] = []
  const marcar = (col: string) => {
    if (!col || jaExiste.has(col)) return
    jaExiste.add(col)
    acrescentar.push(col)
  }

  // Planilhas conectadas antes destas colunas existirem continuam ganhando as duas — no fim.
  marcar(RESPONSE_ID_COLUMN)
  marcar(STATUS_COLUMN)
  // Perguntas novas do formulário. Pergunta RENOMEADA vira coluna nova e a antiga permanece com
  // o histórico dela — que é o comportamento correto: os dados antigos foram coletados sob a
  // pergunta antiga.
  for (const label of fieldLabels) marcar(label)
  marcar(META_EVENTS_COLUMN)
  for (const col of UTM_COLUMNS) marcar(col)

  // IDENTITY_COLUMNS ("nome", "email", "telefone") NUNCA entram em planilha existente: são
  // campos ocultos e acrescentá-las a quem nunca as teve só cria coluna vazia.

  return {
    headers: acrescentar.length > 0 ? [...existingHeaders, ...acrescentar] : existingHeaders,
    needsUpdate: acrescentar.length > 0,
  }
}

function dedup(cols: string[]): string[] {
  const visto = new Set<string>()
  return cols.filter((c) => (c && !visto.has(c) ? (visto.add(c), true) : false))
}

export async function upsertSubmission(opts: UpsertOptions): Promise<UpsertResult> {
  const { spreadsheetId, fieldLabels, answers, questionIdToLabel, utmData, urlParams, responseId, status, rowIndex } = opts
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

    const { headers: updatedHeaders, needsUpdate: needsHeaderUpdate } =
      computeSheetHeaders(existingHeaders, fieldLabels)

    if (needsHeaderUpdate) {
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
      if (!label) continue
      labelToValue[label] = ehAnexoComUrl(value)
        ? celulaDeArquivo(value.name, value.url)
        : protegerCelula(formatAnswerValue(value))
    }

    const now = new Date()
    const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const metaEventsValue = Array.isArray(answers.meta_events)
      ? (answers.meta_events as unknown[]).map(formatAnswerValue).join(', ')
      : ''

    // Coluna de identidade = header chamado nome/email/telefone que NÃO é título de pergunta
    // DESTE formulário. Robusto a reordenação manual de colunas pelo cliente. Pergunta intitulada
    // "email" continua sendo coluna de dados — a RESPOSTA vence o campo oculto.
    const isIdentityHeader = (h: string) =>
      (IDENTITY_COLUMNS as readonly string[]).includes(h) && !fieldLabels.includes(h)

    const row = finalHeaders.map((header) => {
      if (header === 'Data/Hora') return timestamp
      // Identidade em qualquer posição — desde que o nome não colida com o
      // título de uma pergunta do form (aí a RESPOSTA vence, não o url_param).
      if (isIdentityHeader(header)) return protegerCelula(urlParams?.[header] ?? '')
      if (header === RESPONSE_ID_COLUMN) return responseId
      if (header === STATUS_COLUMN) return status
      if (header === META_EVENTS_COLUMN) return protegerCelula(metaEventsValue)
      if (UTM_COLUMNS.includes(header)) return protegerCelula(utmData[header] ?? '')
      return labelToValue[header] ?? ''
    })

    // 4) Com índice: VERIFICA a linha antes de escrever (fix 2026-07-08 v2).
    // O índice gravado pode estar ERRADO: truncado pelo bug antigo do parse
    // (linha 11 anotada como 1), ou defasado porque o dono APAGOU/reordenou
    // linhas da planilha (tudo abaixo desloca). Escrever sem conferir
    // sobrescreveria a linha de OUTRO lead. Regra: só escreve no índice se o
    // response_id DAQUELA linha bater; senão, cai no lookup (4.5), que acha a
    // linha certa ou appenda no fim — e o índice correto volta pro banco.
    const respIdColIdx = finalHeaders.indexOf(RESPONSE_ID_COLUMN)
    if (rowIndex && rowIndex > 1) {
      let verified = false
      if (respIdColIdx >= 0) {
        const colV = columnLetter(respIdColIdx)
        const cellRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `Respostas!${colV}${rowIndex}`,
        })
        const cellVal = cellRes.data.values?.[0]?.[0]
        if (cellVal === responseId) {
          verified = true
        } else {
          logError('[google-sheets] índice gravado não confere com a linha — relocalizando', null, { responseId, rowIndex, encontrado: typeof cellVal === 'string' ? String(cellVal).slice(0, 8) : null })
        }
      } else {
        // planilha muito antiga sem coluna response_id: sem como conferir —
        // mantém o comportamento anterior (escreve no índice gravado).
        verified = true
      }
      if (verified) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Respostas!A${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        })
        return { rowIndex }
      }
    }

    // 4.5) Idempotência sem índice confiável (fix 2026-07-08, auditoria Codex):
    // cobre índice ausente (append anterior FUNCIONOU mas a resposta da API
    // falhou), índice truncado e linha deslocada por deleção manual. Procura o
    // response_id na coluna própria; achou → UPDATE naquela linha.
    // Regra explícita em multiplicidade: a MENOR linha vence + log da anomalia.
    if (respIdColIdx >= 0) {
      const col = columnLetter(respIdColIdx)
      const colRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `Respostas!${col}2:${col}`,
      })
      const colValues = (colRes.data.values ?? []) as string[][]
      const matches: number[] = []
      colValues.forEach((cell, i) => {
        if (cell?.[0] === responseId) matches.push(i + 2)
      })
      if (matches.length > 0) {
        if (matches.length > 1) {
          logError('[google-sheets] response_id em múltiplas linhas — usando a menor', null, { responseId, rows: matches.join(',') })
        }
        const foundRow = matches[0]
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Respostas!A${foundRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        })
        return { rowIndex: foundRow }
      }
    }

    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Respostas!A:A',
      valueInputOption: 'USER_ENTERED',
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

/** Escudo anti-fórmula (18/08): valor de respondente que começa com caractere de fórmula ganha
 *  apóstrofo — condição de segurança para USER_ENTERED existir sem injeção na planilha do cliente. */
export function protegerCelula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

/** Anexo → link CLICÁVEL (=HYPERLINK mostra o NOME e abre o endereço). Separador `;` = locale
 *  pt-BR das planilhas dos clientes; aspas duplicadas escapam dentro da fórmula. */
export function celulaDeArquivo(nome: string, url: string): string {
  const esc = (t: string) => t.replace(/"/g, '""')
  return `=HYPERLINK("${esc(url)}";"${esc(nome)}")`
}

function ehAnexoComUrl(v: unknown): v is { name: string; url: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).name === 'string' &&
    typeof (v as Record<string, unknown>).url === 'string' &&
    String((v as Record<string, unknown>).url).length > 0
}

function formatAnswerValue(value: unknown): string {
  // Delegado ao formatter de domínio: arquivo/endereço/calendly legíveis em vez
  // de JSON cru (auditoria Codex 2026-07-23). Nome local preservado pros call sites.
  return formatDomainAnswer(value, { sink: 'export' })
}
