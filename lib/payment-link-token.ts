import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Token do link de pagamento da régua de cobrança (D-01, 11/08/2026).
 *
 * POR QUE EXISTE: o botão do template de WhatsApp precisa de URL com a parte variável NO FIM
 * (exigência da Meta) e no NOSSO domínio — o Sidney foi explícito: o cliente comprou do
 * Instituto Eidos e não pode ver o nome do gateway em lugar nenhum, nem no link.
 *
 * O GANHO ESTRUTURAL, e é o motivo de valer 40 linhas: a Meta aprova
 * `eidosform.com.br/pagar/{{1}}` UMA vez. Para onde essa rota redireciona é código nosso —
 * hoje a fatura, amanhã a tela de atualizar cartão quando ela existir, depois de amanhã outro
 * gateway. **O template nunca mais precisa de aprovação.** Botão de URL editado dispara nova
 * análise na Meta; a flexibilidade tem de morar na ROTA, não no botão.
 *
 * ⚠️ POR QUE ASSINADO E COM PRAZO: a rota redireciona para a fatura, que mostra nome, valor e
 * dados de cobrança do cliente. Um `/pagar/{profileId}` cru seria enumerável — e o profileId
 * aparece em outros lugares. O token é HMAC preso ao perfil e morre em 15 dias (3× a régua de
 * 5 dias, com folga para quem só abre a mensagem depois).
 */

const TTL_MS = 15 * 24 * 60 * 60 * 1000

function signingSecret(): string {
  // SEGREDO DEDICADO, sem cadeia de fallback (S3, auditoria 14/08). Antes caía em
  // INTERNAL_API_SECRET e até na service-role do Supabase: um mesmo segredo assinando link
  // público de pagamento e autenticando rotas internas amarra dois raios de dano que não têm
  // motivo para andar juntos — e rotacionar um obrigaria a rotacionar o outro.
  // Ausente = NÃO ASSINA. A régua trata link nulo desde sempre (o e-mail troca o botão por
  // "responda este e-mail"), então falhar fechado aqui degrada, não quebra.
  return process.env.PAYMENT_LINK_TOKEN_SECRET || ''
}

/** Só [A-Za-z0-9_-] — o token viaja na URL e precisa sobreviver a qualquer encoder. */
function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}
function deB64url(s: string): string | null {
  try { return Buffer.from(s, 'base64url').toString('utf8') } catch { return null }
}

/**
 * Gera o token para um perfil. `null` quando não há segredo configurado — o chamador então
 * manda a mensagem SEM botão, que é melhor que um botão que erra o destino.
 */
export function signPaymentLinkToken(profileId: string, agora = Date.now()): string | null {
  const secret = signingSecret()
  if (!secret || !profileId) return null
  const expira = agora + TTL_MS
  const corpo = b64url(`${profileId}.${expira}`)
  const assinatura = createHmac('sha256', secret).update(corpo).digest('base64url')
  return `${corpo}.${assinatura}`
}

/** Devolve o profileId se o token é íntegro e não expirou; `null` em qualquer outro caso. */
export function verifyPaymentLinkToken(token: string | undefined | null, agora = Date.now()): string | null {
  const secret = signingSecret()
  if (!secret || !token) return null
  const partes = token.split('.')
  if (partes.length !== 2) return null
  const [corpo, assinatura] = partes

  const esperada = createHmac('sha256', secret).update(corpo).digest('base64url')
  // Comparação em tempo constante (D10 do lote 2-bis): `===` em segredo vaza por timing.
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const claro = deB64url(corpo)
  if (!claro) return null
  const corte = claro.lastIndexOf('.')
  if (corte <= 0) return null
  const profileId = claro.slice(0, corte)
  const expira = Number(claro.slice(corte + 1))
  if (!Number.isFinite(expira) || agora >= expira) return null
  return profileId || null
}
