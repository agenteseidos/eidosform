import type { QuestionConfig } from '@/lib/database.types'

/**
 * Config server-only do form de migração (/f/migracao).
 *
 * Os IDs das perguntas são PINADOS porque o form é gerado por `scripts/seed-form.mjs`
 * com UUIDs aleatórios — não há como derivar com segurança só por tipo (há 2 campos
 * `email` condicionais). Se o form for recriado, atualizar os IDs aqui; a função
 * `validarContratoForm` detecta a divergência em runtime e o endpoint responde 503
 * em vez de cruzar o campo errado (o que poderia vazar/errar dado).
 *
 * `formId` pode ser sobrescrito por env (`MIGRATION_FORM_ID`); o fallback é o id atual
 * em produção. NUNCA é recebido do body da requisição.
 */
// Número de env com validação: NaN/zero/negativo cai no default (Codex P3 2026-07-01).
function envNum(v: string | undefined, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

export const MIGRACAO = {
  formId: process.env.MIGRATION_FORM_ID || 'ecaa7ab8-f74f-465f-bd8f-fd41c7bc2da4',
  slug: 'migracao',
  eligibilityDays: envNum(process.env.MIGRACAO_ELIGIBILITY_DAYS, 90),
  // Janela do BENEFÍCIO (política Sidney 2026-07-01): migração feita-pela-equipe só p/ assinatura
  // ANUAL vigente iniciada há ≤ N dias. (≠ eligibilityDays, que é a janela da SUBMISSÃO do form.)
  beneficioDias: envNum(process.env.MIGRACAO_BENEFICIO_DIAS, 20),
  q: {
    nome: '558df868-0e71-4e6e-a779-9efdf040b2e5',
    telefone: '54b813d7-39bd-4081-81a1-8f8a4341ba37',
    jaConta: 'a90c23c7-08af-498b-a5d0-1c9fc69010a5',
    emailSim: 'ca2d20ed-88bc-43f2-8ef4-9719540a58e3',
    emailNao: 'a2746547-6232-4ca8-8f27-54f26a6b8324',
    ferramenta: '04f8725b-243e-4ab7-94d2-6734bbeea11a',
    links: '7c694951-a620-404b-8e96-73afa5bc0c53',
    respostasMes: 'c17c30b6-a669-4e25-8a4c-4ee9a4a39948',
    recursos: '887dd0bf-6713-4f25-b345-0d89af4a6b36',
    qtdForms: 'dba26b85-da17-4ffb-a2e5-8fed4803505c',
    maiorForm: '44de1954-80b0-48ed-966e-08d7c1f70ab4',
  },
} as const

const TIPOS_ESPERADOS: Record<string, string> = {
  nome: 'short_text',
  telefone: 'phone',
  jaConta: 'yes_no',
  emailSim: 'email',
  emailNao: 'email',
  ferramenta: 'dropdown',
  links: 'long_text',
  respostasMes: 'dropdown',
  recursos: 'checkboxes',
  qtdForms: 'number',
  maiorForm: 'dropdown',
}

// Extrai a 1ª regra de visibilidade de uma pergunta (formato legado = ConditionalRule
// única; formato novo = ConditionalGroup com `rules`). Sem dependência do motor.
function regraVisibilidade(q: QuestionConfig | undefined): { questionId?: string; value?: string } | null {
  const cl = q?.conditionalLogic as unknown
  if (!cl || typeof cl !== 'object') return null
  const obj = cl as { questionId?: string; value?: string; rules?: Array<{ questionId?: string; value?: string }> }
  if (Array.isArray(obj.rules)) return obj.rules[0] ?? null
  if (obj.questionId) return { questionId: obj.questionId, value: obj.value }
  return null
}

/**
 * Confere que o form no banco ainda casa com os IDs/tipos/condicionais pinados.
 * Se algo divergir, o contrato do form mudou → o endpoint deve falhar (503),
 * nunca tentar adivinhar o campo.
 */
export function validarContratoForm(
  questions: QuestionConfig[] | null | undefined
): { ok: boolean; erros: string[] } {
  const erros: string[] = []
  const byId = new Map((questions ?? []).map((qq) => [qq.id, qq]))

  for (const [chave, id] of Object.entries(MIGRACAO.q)) {
    const qq = byId.get(id)
    if (!qq) {
      erros.push(`pergunta "${chave}" (${id}) não existe no form`)
      continue
    }
    const tipo = TIPOS_ESPERADOS[chave]
    if (tipo && qq.type !== tipo) erros.push(`pergunta "${chave}": tipo ${qq.type} ≠ esperado ${tipo}`)
  }

  const eSim = regraVisibilidade(byId.get(MIGRACAO.q.emailSim))
  if (!eSim || eSim.questionId !== MIGRACAO.q.jaConta || String(eSim.value ?? '').trim().toLowerCase() !== 'sim') {
    erros.push('emailSim não está condicionado a "já tem conta = Sim"')
  }
  const eNao = regraVisibilidade(byId.get(MIGRACAO.q.emailNao))
  if (!eNao || eNao.questionId !== MIGRACAO.q.jaConta || String(eNao.value ?? '').trim().toLowerCase() !== 'não') {
    erros.push('emailNao não está condicionado a "já tem conta = Não"')
  }

  return { ok: erros.length === 0, erros }
}
