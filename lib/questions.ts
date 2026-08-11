import { QuestionType, QuestionConfig } from './database.types'
import { PlanId, planAtLeast } from './plans'
import {
  Type,
  AlignLeft,
  List,
  ChevronDown,
  CheckSquare,
  Mail,
  Phone,
  Hash,
  Calendar,
  Star,
  Gauge,
  ThumbsUp,
  Upload,
  Link,
  LucideIcon,
  MapPin,
  Fingerprint,
  CalendarClock,
  Code,
  TextCursorInput,
} from 'lucide-react'

export interface QuestionTypeInfo {
  type: QuestionType
  label: string
  description: string
  icon: LucideIcon
  defaultConfig: Partial<QuestionConfig>
}

export const questionTypes: QuestionTypeInfo[] = [
  {
    type: 'short_text',
    label: 'Texto Curto',
    description: 'Uma linha de texto',
    icon: Type,
    defaultConfig: {
      placeholder: 'Digite sua resposta...',
    },
  },
  {
    type: 'long_text',
    label: 'Texto Longo',
    description: 'Área de texto multilinha',
    icon: AlignLeft,
    defaultConfig: {
      placeholder: 'Digite sua resposta...',
    },
  },
  {
    type: 'dropdown',
    label: 'Múltipla Escolha',
    description: 'Escolha única entre várias opções',
    icon: List,
    defaultConfig: {
      options: ['Opção 1', 'Opção 2', 'Opção 3'],
    },
  },
  {
    type: 'select',
    label: 'Lista Suspensa',
    description: 'Menu suspenso compacto (ideal para listas longas)',
    icon: ChevronDown,
    defaultConfig: {
      options: ['Opção 1', 'Opção 2', 'Opção 3'],
      placeholder: 'Selecione uma opção...',
    },
  },
  {
    type: 'checkboxes',
    label: 'Caixas de Seleção',
    description: 'Selecione múltiplas opções',
    icon: CheckSquare,
    defaultConfig: {
      options: ['Opção 1', 'Opção 2', 'Opção 3'],
    },
  },
  {
    type: 'email',
    label: 'Email',
    description: 'Campo de e-mail',
    icon: Mail,
    defaultConfig: {
      placeholder: 'nome@exemplo.com',
    },
  },
  {
    type: 'phone',
    label: 'Telefone',
    description: 'Campo de telefone',
    icon: Phone,
    defaultConfig: {
      placeholder: '(11) 99999-0000',
    },
  },
  {
    type: 'number',
    label: 'Número',
    description: 'Campo numérico',
    icon: Hash,
    defaultConfig: {
      placeholder: '0',
    },
  },
  {
    type: 'date',
    label: 'Data',
    description: 'Seletor de data',
    icon: Calendar,
    defaultConfig: {},
  },
  {
    type: 'rating',
    label: 'Avaliação',
    description: 'Avaliação com estrelas (1-5)',
    icon: Star,
    defaultConfig: {
      minValue: 1,
      maxValue: 5,
    },
  },
  {
    type: 'opinion_scale',
    label: 'Escala de Opinião',
    description: 'Escala numérica (1-10)',
    icon: Gauge,
    defaultConfig: {
      minValue: 1,
      maxValue: 10,
    },
  },
  {
    type: 'yes_no',
    label: 'Sim / Não',
    description: 'Escolha simples de sim ou não',
    icon: ThumbsUp,
    defaultConfig: {},
  },
  {
    type: 'file_upload',
    label: 'Upload de Arquivo',
    description: 'Envie imagens ou PDFs',
    icon: Upload,
    defaultConfig: {
      allowedFileTypes: ['image/*', 'application/pdf'],
      maxFileSize: 10, // MB
    },
  },
  {
    type: 'nps',
    label: 'Avaliação (0-10)',
    description: 'Net Promoter Score (0-10)',
    icon: Gauge,
    defaultConfig: {
      minValue: 0,
      maxValue: 10,
    },
  },
  {
    type: 'url',
    label: 'URL do Site',
    description: 'Campo de URL',
    icon: Link,
    defaultConfig: {
      placeholder: 'https://exemplo.com',
    },
  },
  {
    type: 'address',
    label: 'Endereço / CEP',
    description: 'Endereço completo com busca por CEP',
    icon: MapPin,
    defaultConfig: {
      placeholder: '00000-000',
    },
  },
  {
    type: 'cpf',
    label: 'CPF / CNPJ',
    description: 'Campo de CPF ou CNPJ com máscara e validação',
    icon: Fingerprint,
    defaultConfig: {
      placeholder: '000.000.000-00',
    },
  },
  {
    type: 'calendly',
    label: 'Agendar com Calendly',
    description: 'Agendamento integrado via Calendly',
    icon: CalendarClock,
    defaultConfig: {
      calendlyUrl: '',
    },
  },
  {
    type: 'html_block',
    label: 'Bloco HTML',
    description: 'Cole HTML/embed (Google Calendar, YouTube, Maps, etc.)',
    icon: Code,
    defaultConfig: {
      required: false,
      htmlContent: '',
    },
  },
  {
    type: 'content_block',
    label: 'Bloco de Conteúdo',
    description: 'Texto rico com botão de ação',
    icon: TextCursorInput,
    defaultConfig: {
      required: false,
      contentBody: '',
      contentButtonText: 'Continuar',
      contentButtonUrl: '',
    },
  },
]

/**
 * Tipos de pergunta gateados por plano (fonte única de verdade — builder e
 * player público importam daqui). Tipo ausente = disponível em qualquer plano.
 *   - cpf: validação de CPF/CNPJ → Starter+
 *   - calendly: agendamento integrado → Starter+
 *   - html_block: embeds HTML arbitrários → Plus+
 */
export const QUESTION_TYPE_MIN_PLAN: Partial<Record<QuestionType, PlanId>> = {
  cpf: 'starter',
  calendly: 'starter',
  html_block: 'plus',
}

/** O plano informado pode usar este tipo de pergunta? */
export function questionTypeAllowed(type: QuestionType, plan: string | null | undefined): boolean {
  const min = QUESTION_TYPE_MIN_PLAN[type]
  return !min || planAtLeast(plan, min)
}

/**
 * Remove do array as perguntas de tipo gated que o plano não permite (player
 * público e endpoints de submissão). Forms legados / pós-downgrade podem conter
 * perguntas premium em planos insuficientes — aqui elas simplesmente não são
 * entregues ao visitante nem aceitas por POST direto. O
 * motor de lógica ignora jumps cujo alvo sumiu (form-logic-engine getNextQuestionId),
 * então a remoção é segura para a navegação.
 */
export function filterQuestionsByPlan<T extends { type: QuestionType }>(
  questions: T[],
  plan: string | null | undefined,
): T[] {
  return questions.filter(q => questionTypeAllowed(q.type, plan))
}

export function getQuestionTypeInfo(type: QuestionType): QuestionTypeInfo | undefined {
  return questionTypes.find(qt => qt.type === type)
}

export function createDefaultQuestion(type: QuestionType): QuestionConfig {
  const typeInfo = getQuestionTypeInfo(type)
  const id = crypto.randomUUID()
  
  return {
    id,
    type,
    title: '',
    description: '',
    required: false,
    ...typeInfo?.defaultConfig,
  }
}

/** Tipos cuja resposta é escolha entre opções — os únicos que carregam `options`. */
export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set(['dropdown', 'select', 'checkboxes'])

/**
 * O que muda numa pergunta quando o dono TROCA O TIPO no construtor.
 *
 * 🐞 O DEFEITO (E06-S1-002, aberto desde a auditoria; fechado em 11/08/2026): `handleTypeChange`
 * espalhava o `defaultConfig` do tipo novo por cima da pergunta — e o defaultConfig dos tipos de
 * escolha traz `options: ['Opção 1', 'Opção 2', 'Opção 3']`. Trocar "múltipla escolha" por
 * "seleção" APAGAVA as opções escritas à mão e devolvia as genéricas. Numa pergunta com 20
 * alternativas, é trabalho perdido sem aviso e sem desfazer.
 *
 * A regra certa: entre tipos de ESCOLHA, as opções são do dono e sobrevivem. Saindo de escolha
 * para qualquer outra coisa, `options` é limpo (não faz sentido em texto/data/nota). Entrando em
 * escolha vindo de fora, o default é o ponto de partida — aí não há nada do dono a preservar.
 *
 * Função pura de propósito: não existe teste de componente React neste repositório, e a regra
 * some de vista se ficar solta dentro do painel (foi assim que ela passou meses errada).
 */
export function buildTypeChangeUpdates(
  atual: Pick<QuestionConfig, 'type' | 'options'>,
  novoTipo: QuestionType,
): Partial<QuestionConfig> {
  const info = getQuestionTypeInfo(novoTipo)
  const updates: Partial<QuestionConfig> = { type: novoTipo, ...info?.defaultConfig }

  const eraEscolha = CHOICE_TYPES.has(atual.type)
  const viraEscolha = CHOICE_TYPES.has(novoTipo)

  if (!viraEscolha) {
    updates.options = undefined
    return updates
  }
  // Escolha → escolha: preserva o que o dono escreveu (só cai no default se não houver nada).
  if (eraEscolha && Array.isArray(atual.options) && atual.options.length > 0) {
    updates.options = [...atual.options]
  }
  return updates
}
