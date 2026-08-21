/**
 * lib/hero-demo/config.ts — os IDs PINADOS do formulário de captura do hero.
 *
 * O hero das landings (/v3 e /v4) deixou de ser teatro e passou a gravar num formulário
 * EidosForm de verdade (D-10). Isso cria um acoplamento perigoso: a página grava respostas
 * usando IDs de pergunta. Se alguém apagar, recriar ou reordenar o formulário no painel, os IDs
 * mudam — e sem esta trava a página passaria a gravar **o nome no campo de e-mail**, em silêncio,
 * até alguém abrir o painel e não entender nada.
 *
 * Mesma disciplina de `lib/migracao/config.ts`: os IDs vivem AQUI, e um contrato verificado em
 * runtime falha ALTO se o formulário no banco não for exatamente o esperado.
 *
 * ⚠️ Se este arquivo precisar mudar, o formulário mudou. Confirme no banco antes de editar —
 * o repositório não descreve o banco (REGRA Nº 1).
 */

/** Conta técnica dedicada. Isolada da conta operacional de propósito: cota, dashboard e
 *  exportações da landing não podem se misturar com os formulários que rodam o negócio. */
export const HERO_OWNER_ID = '0ddc43bb-e356-4b53-966a-80a89b96fbcd'
export const HERO_OWNER_EMAIL = 'leads@eidosform.com.br'

export const HERO_FORM_ID = '3a75e850-7a5f-4875-96ce-c2b98219098e'
export const HERO_FORM_SLUG = 'demo'

/** Ordem FECHADA pelo Sidney: contato cedo. Quem abandona no objetivo já deixou telefone. */
export const HERO_Q = {
  nome:     'e6c62c7d-faf4-4865-a78e-50d403c0768f',
  whatsapp: 'a1003ce2-fc09-4acd-89bc-c17c206c34e2',
  email:    '9ecfd0b6-1500-4d72-9a20-825bdf471fd1',
  objetivo: '2ed30491-6f4e-457b-ba51-2090d9c6920f',
  volume:   '516ee4c9-ccd6-4393-8cf7-7c5886ae98bf',
} as const

export const HERO_OBJETIVOS = [
  'Capturar mais leads',
  'Aumentar conversão',
  'Fazer pesquisas',
] as const

export const HERO_VOLUMES = ['Até 100', 'Até 1.000', 'Até 5.000', 'Mais de 5.000'] as const

/**
 * O volume declarado → plano recomendado.
 *
 * ⚠️ REGRA DO SIDNEY (20/08/2026): **NUNCA recomendar o plano Free.** Recomendação é momento de
 * venda; apontar o gratuito mata a conversão no ato. Quem espera até 100 respostas/mês recebe
 * Starter, não Free. Vale aqui, na tela de obrigado e na conversa da Elen.
 */
export const PLANO_POR_VOLUME: Record<string, { plano: string; frase: string }> = {
  'Até 100':        { plano: 'Starter',      frase: 'o plano Starter dá conta com folga' },
  'Até 1.000':      { plano: 'Starter',      frase: 'o plano Starter atende até 1.000 respostas por mês' },
  'Até 5.000':      { plano: 'Plus',         frase: 'o plano Plus atende até 5.000 respostas por mês' },
  'Mais de 5.000':  { plano: 'Professional', frase: 'o plano Professional atende até 15.000 respostas por mês' },
}

export type ContratoHero =
  | { ok: true }
  | { ok: false; motivo: string }

type FormLido = {
  id?: string
  user_id?: string
  status?: string
  is_closed?: boolean
  paused?: boolean
  notify_owner_enabled?: boolean | null
  notify_email_enabled?: boolean | null
  google_sheets_enabled?: boolean | null
  pixels?: unknown
  questions?: Array<{ id?: string; type?: string; required?: boolean; options?: unknown }>
}

/**
 * O formulário no banco ainda é EXATAMENTE o que esta página espera?
 *
 * Falha ALTO e ANTES do visitante começar — não 30 minutos depois, no worker. Confere:
 * dono, publicação, IDs/tipos/ordem das 5 perguntas, opções das duas de escolha, e as flags
 * que garantem silêncio (notificação, planilha) e ausência de pixel/CAPI nesta conta.
 */
export function conferirContratoHero(form: FormLido | null): ContratoHero {
  if (!form) return { ok: false, motivo: 'formulário não encontrado' }
  if (form.id !== HERO_FORM_ID) return { ok: false, motivo: 'id do formulário divergente' }
  if (form.user_id !== HERO_OWNER_ID) return { ok: false, motivo: 'dono divergente' }
  if (form.status !== 'published') return { ok: false, motivo: `status ${form.status}` }
  if (form.is_closed) return { ok: false, motivo: 'formulário fechado' }
  if (form.paused) return { ok: false, motivo: 'formulário pausado' }

  // Silêncio obrigatório: a demo não pode gerar e-mail para ninguém nem linha em planilha.
  if (form.notify_owner_enabled) return { ok: false, motivo: 'notificação ao dono LIGADA' }
  if (form.notify_email_enabled) return { ok: false, motivo: 'notificação por e-mail LIGADA' }
  if (form.google_sheets_enabled) return { ok: false, motivo: 'Google Sheets ligado' }
  // Sem pixel nesta conta: a demo não deve gerar evento de CAPI de ninguém.
  if (form.pixels && Object.keys(form.pixels as object).length > 0) {
    return { ok: false, motivo: 'pixels configurados nesta conta' }
  }

  const qs = form.questions ?? []
  const esperado: Array<[string, string]> = [
    [HERO_Q.nome, 'short_text'],
    [HERO_Q.whatsapp, 'phone'],
    [HERO_Q.email, 'email'],
    [HERO_Q.objetivo, 'multiple_choice'],
    [HERO_Q.volume, 'multiple_choice'],
  ]
  if (qs.length !== esperado.length) {
    return { ok: false, motivo: `esperava ${esperado.length} perguntas, achei ${qs.length}` }
  }
  for (let i = 0; i < esperado.length; i++) {
    const [id, tipo] = esperado[i]
    if (qs[i]?.id !== id) return { ok: false, motivo: `pergunta ${i + 1} com id divergente` }
    if (qs[i]?.type !== tipo) return { ok: false, motivo: `pergunta ${i + 1} com tipo divergente` }
    if (qs[i]?.required !== true) return { ok: false, motivo: `pergunta ${i + 1} deixou de ser obrigatória` }
  }
  // As opções alimentam a recomendação de plano; mudar uma quebra o mapa em silêncio.
  const opcoes = (i: number) => (qs[i]?.options as string[] | undefined) ?? []
  if (JSON.stringify(opcoes(3)) !== JSON.stringify([...HERO_OBJETIVOS])) {
    return { ok: false, motivo: 'opções de objetivo divergentes' }
  }
  if (JSON.stringify(opcoes(4)) !== JSON.stringify([...HERO_VOLUMES])) {
    return { ok: false, motivo: 'opções de volume divergentes' }
  }
  return { ok: true }
}

/** A recomendação de plano a partir do volume declarado. Nunca devolve Free (regra do Sidney). */
export function recomendarPlano(volume: string | null | undefined): { plano: string; frase: string } {
  return PLANO_POR_VOLUME[String(volume ?? '')] ?? PLANO_POR_VOLUME['Até 1.000']
}
