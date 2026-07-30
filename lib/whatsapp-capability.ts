/**
 * CAPACIDADE — "notificação de lead por WhatsApp".
 *
 * Fonte ÚNICA de verdade sobre QUEM pode usar a notificação de lead por
 * WhatsApp. Todos os caminhos (sink de envio, disparador do submit, cron de
 * lead abandonado, rotas de configuração, UI do builder) consultam esta função.
 *
 * ── POR QUE ISTO EXISTE (decisão Sidney, 2026-07-30) ─────────────────────────
 * A feature depende de cliente NÃO-OFICIAL de WhatsApp (whatsmeow). Em 27–30/07
 * a linha sofreu 3 revogações de dispositivos e terminou com **restrição de 6h
 * da conta** — o degrau anterior ao banimento permanente. A decisão foi vender o
 * EidosForm SEM essa feature e mantê-la ativa apenas na conta do próprio Sidney,
 * até existir um desenho seguro (ver ficha `notificacao-lead-whatsapp-eidosform`).
 *
 * ── POR QUE NÃO É `isAdminEmail` (correção da auditoria Codex) ───────────────
 * "Ser administrador" e "poder usar notificação de lead por WhatsApp" são
 * capacidades DIFERENTES. Se amarrássemos as duas, adicionar um segundo admin no
 * futuro daria de brinde uma feature operacionalmente perigosa. Por isso:
 * lista própria, por **UUID** (imutável) e não por e-mail (que muda).
 *
 * ── FAIL-CLOSED, DE PROPÓSITO ────────────────────────────────────────────────
 * Env ausente/vazia ⇒ **ninguém** pode usar. Um erro de configuração deixa a
 * feature desligada (seguro) em vez de aberta para toda a base (perigoso).
 * ⚠️ Consequência operacional: sem `WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS`
 * setada no ambiente, NEM O ADMIN recebe notificação. É requisito de deploy.
 *
 * ── EVOLUÇÃO ─────────────────────────────────────────────────────────────────
 * Quando a feature voltar a ser vendável (ex.: cada cliente conectando o próprio
 * número), troca-se a IMPLEMENTAÇÃO desta função por um entitlement por tenant.
 * Nenhum consumidor precisa mudar.
 */

/** UUIDs autorizados, vindos do ambiente. Sem env = lista vazia = ninguém. */
export function getLeadWhatsAppAllowedUserIds(): string[] {
  const raw = process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS ?? ''
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

/**
 * O DONO do formulário pode usar notificação de lead por WhatsApp?
 *
 * ⚠️ Recebe sempre o dono do FORMULÁRIO — nunca quem está fazendo a requisição.
 * Um admin editando o formulário de um cliente NÃO pode habilitar a feature para
 * aquele cliente; quem manda é de quem é o formulário.
 */
export function canUseLeadWhatsApp(ownerUserId?: string | null): boolean {
  if (!ownerUserId) return false
  return getLeadWhatsAppAllowedUserIds().includes(ownerUserId.trim().toLowerCase())
}

/** Mensagem única para respostas de recusa — evita divergir texto por rota. */
export const LEAD_WHATSAPP_UNAVAILABLE =
  'A notificação por WhatsApp está temporariamente indisponível.'
