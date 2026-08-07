import { timingSafeEqual } from 'node:crypto'

/**
 * Comparação de segredo em tempo constante para `Authorization: Bearer <segredo>`.
 *
 * FONTE ÚNICA (auditoria 2026-08, lote 2-bis · D10). Antes, duas rotas internas faziam a coisa
 * certa com `timingSafeEqual` e OUTRAS OITO comparavam com `===` — os 6 crons, o disparo de
 * WhatsApp, `plano/lookup` e `migracao/recommend`, todas usando o MESMO segredo.
 *
 * Por que `===` é ruim aqui: a comparação de strings do JavaScript sai no primeiro caractere
 * diferente, então o tempo de resposta vaza quantos caracteres iniciais estão certos. Com
 * medições repetidas dá para reconstruir o segredo caractere a caractere, sem nunca acertá-lo
 * por sorte. `timingSafeEqual` compara sempre o buffer inteiro.
 *
 * Na prática o ruído de rede torna esse ataque difícil pela internet — mas o custo de fazer
 * certo é uma linha, e as rotas protegidas aqui disparam cobrança, cancelam plano e enviam
 * WhatsApp pago.
 *
 * A comparação de COMPRIMENTO acontece antes de propósito: `timingSafeEqual` LANÇA se os
 * buffers tiverem tamanhos diferentes. Isso vaza o tamanho do segredo, o que é irrelevante
 * (segredo tem tamanho fixo conhecido) perto de vazar o conteúdo.
 */
export function isValidBearerSecret(
  authorizationHeader: string | null,
  expectedSecret: string | undefined | null
): boolean {
  if (!expectedSecret) return false
  if (!authorizationHeader?.startsWith('Bearer ')) return false

  const recebido = Buffer.from(authorizationHeader.slice(7).trim())
  const esperado = Buffer.from(expectedSecret)

  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}
