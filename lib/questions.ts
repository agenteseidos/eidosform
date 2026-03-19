import { QuestionType, QuestionConfig } from './database.types'
import { 
  Type, 
  AlignLeft, 
  List, 
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
  MapPin
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
    label: 'Lista Suspensa',
    description: 'Selecione uma opção da lista',
    icon: List,
    defaultConfig: {
      options: ['Opção 1', 'Opção 2', 'Opção 3'],
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
      placeholder: '(00) 00000-0000',
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
    label: 'NPS',
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
]

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

