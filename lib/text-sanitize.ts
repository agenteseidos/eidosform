/**
 * lib/text-sanitize.ts — limpeza de caracteres invisíveis/de controle em texto
 * vindo do LEAD, compartilhada por todos os canais de notificação.
 *
 * Extraído de lib/whatsapp-template.ts (P2-7) quando o e-mail passou a precisar
 * exatamente da mesma proteção. O código é o mesmo, byte a byte — o WhatsApp
 * segue importando daqui, e lib/whatsapp-regression.test.ts prova que a
 * mensagem não mudou.
 *
 * Duas classes recebem tratamento DIFERENTE, de propósito:
 *  - `\p{Cf}` (formatação invisível: zero-width, overrides bidirecionais) é
 *    REMOVIDA — não separa palavras, só serve pra enganar quem lê.
 *  - `\p{Cc}` (controle: \n, \r, \t) vira ESPAÇO — era um separador legítimo,
 *    e apagá-lo grudaria palavras ("João\nSilva" → "JoãoSilva").
 *
 * ⚠️ Isto NÃO é escape de HTML. No e-mail, o resultado daqui ainda precisa
 * passar por escapeHtml (lib/html) antes de entrar no corpo.
 */

const INVISIBLE_FORMAT = /\p{Cf}/gu
const CONTROL_CHARS = /\p{Cc}/gu
/** Controles EXCETO \n (blocos legítimos multi-linha: {respostas}, anexos). */
const CONTROL_EXCEPT_NEWLINE = /[^\n\P{Cc}]/gu

/** Achata para UMA linha: controle vira espaço, espaços colapsam. */
export function sanitizeSingleLine(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_FORMAT, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Preserva quebras de linha legítimas; mata o resto do controle. */
export function sanitizeMultiLine(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE_FORMAT, '')
    .replace(CONTROL_EXCEPT_NEWLINE, ' ')
}
