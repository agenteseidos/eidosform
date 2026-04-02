/**
 * lib/field-validators.ts — Validação backend por tipo de campo
 * Garante consistência de dados independente do frontend.
 */

import { QuestionConfig, QuestionType } from './database.types'
import { validateCPF } from './validators'

export interface FieldValidationResult {
  valid: boolean
  error?: string
  /** Valor sanitizado/normalizado (se diferente do original) */
  sanitized?: unknown
}

/**
 * Valida um valor de resposta contra o tipo de campo esperado.
 * Retorna { valid: true } ou { valid: false, error: '...' }.
 * Opcionalmente retorna sanitized com o valor normalizado.
 */
export function validateFieldValue(
  question: QuestionConfig,
  value: unknown
): FieldValidationResult {
  // Campos vazios são ok (obrigatoriedade é checada separadamente)
  if (value === undefined || value === null || value === '') {
    return { valid: true }
  }

  switch (question.type) {
    case 'short_text':
    case 'long_text':
      return validateText(value)

    case 'email':
      return validateEmail(value)

    case 'phone':
      return validatePhone(value)

    case 'number':
      return validateNumber(value)

    case 'date':
      return validateDate(value)

    case 'url':
      return validateUrl(value)

    case 'rating':
      return validateRange(value, question.minValue ?? 1, question.maxValue ?? 5, 'Avaliação')

    case 'opinion_scale':
      return validateRange(value, question.minValue ?? 1, question.maxValue ?? 10, 'Escala')

    case 'nps':
      return validateRange(value, 0, 10, 'NPS')

    case 'yes_no':
      return validateYesNo(value)

    case 'dropdown':
      return validateDropdown(value, question.options ?? [])

    case 'checkboxes':
      return validateCheckboxes(value, question.options ?? [])

    case 'file_upload':
      return validateFileUpload(value)

    case 'address':
      return validateAddress(value)

    case 'cpf':
      return validateCpfField(value)

    case 'content_block':
      return validateContentBlock(value)

    case 'calendly':
      return validateCalendly(value)

    default:
      // Tipo desconhecido — aceitar para forward-compatibility
      return { valid: true }
  }
}

/**
 * Valida todas as respostas contra as definições de perguntas.
 * Retorna lista de erros (vazia = tudo ok).
 */
export function validateAllAnswers(
  questions: QuestionConfig[],
  answers: Record<string, unknown>
): { questionId: string; error: string }[] {
  const errors: { questionId: string; error: string }[] = []
  const questionMap = new Map(questions.map(q => [q.id, q]))

  for (const [questionId, value] of Object.entries(answers)) {
    const question = questionMap.get(questionId)
    if (!question) {
      errors.push({ questionId, error: 'Pergunta desconhecida' })
      continue
    }

    const result = validateFieldValue(question, value)
    if (!result.valid && result.error) {
      errors.push({ questionId, error: result.error })
    }
  }

  return errors
}

// ── Validadores individuais ──

function validateText(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Valor deve ser texto' }
  }
  if (value.length > 10_000) {
    return { valid: false, error: 'Texto excede o limite de 10.000 caracteres' }
  }
  return { valid: true }
}

function validateEmail(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Email deve ser texto' }
  }
  // RFC 5322 simplificado — cobre 99%+ dos emails válidos
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value)) {
    return { valid: false, error: 'Email inválido' }
  }
  if (value.length > 320) {
    return { valid: false, error: 'Email muito longo' }
  }
  return { valid: true }
}

function validatePhone(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Telefone deve ser texto' }
  }
  // Aceita formatos internacionais: +55119999900000, etc.
  const clean = value.replace(/[\s\-().]/g, '')
  if (!/^\+?\d{7,15}$/.test(clean)) {
    return { valid: false, error: 'Telefone inválido (7-15 dígitos)' }
  }
  return { valid: true }
}

function validateNumber(value: unknown): FieldValidationResult {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || isNaN(num)) {
    return { valid: false, error: 'Valor deve ser numérico' }
  }
  if (!isFinite(num)) {
    return { valid: false, error: 'Valor numérico inválido' }
  }
  return { valid: true, sanitized: num }
}

function validateDate(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Data deve ser texto no formato YYYY-MM-DD' }
  }
  // Aceita ISO 8601 date ou datetime
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return { valid: false, error: 'Data inválida (formato esperado: YYYY-MM-DD)' }
  }
  const parsed = new Date(value)
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Data inválida' }
  }
  return { valid: true }
}

function validateUrl(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'URL deve ser texto' }
  }
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'URL deve usar http ou https' }
    }
  } catch {
    return { valid: false, error: 'URL inválida' }
  }
  return { valid: true }
}

function validateRange(
  value: unknown,
  min: number,
  max: number,
  label: string
): FieldValidationResult {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || isNaN(num)) {
    return { valid: false, error: `${label} deve ser um número` }
  }
  if (!Number.isInteger(num)) {
    return { valid: false, error: `${label} deve ser um número inteiro` }
  }
  if (num < min || num > max) {
    return { valid: false, error: `${label} deve estar entre ${min} e ${max}` }
  }
  return { valid: true, sanitized: num }
}

function validateYesNo(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Resposta deve ser texto' }
  }
  if (!['Sim', 'Não', 'sim', 'não', 'yes', 'no'].includes(value)) {
    return { valid: false, error: 'Resposta deve ser Sim ou Não' }
  }
  return { valid: true }
}

function validateDropdown(value: unknown, options: string[]): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Seleção deve ser texto' }
  }
  if (options.length > 0 && !options.includes(value)) {
    return { valid: false, error: 'Opção selecionada não é válida' }
  }
  return { valid: true }
}

function validateCheckboxes(value: unknown, options: string[]): FieldValidationResult {
  if (!Array.isArray(value)) {
    return { valid: false, error: 'Seleções devem ser uma lista' }
  }
  if (!value.every(v => typeof v === 'string')) {
    return { valid: false, error: 'Cada seleção deve ser texto' }
  }
  if (options.length > 0) {
    const invalid = value.filter(v => !options.includes(v as string))
    if (invalid.length > 0) {
      return { valid: false, error: `Opções inválidas: ${invalid.join(', ')}` }
    }
  }
  return { valid: true }
}

function validateFileUpload(value: unknown): FieldValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Upload deve ser um objeto com name e url' }
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.name !== 'string' || typeof obj.url !== 'string') {
    return { valid: false, error: 'Upload deve ter name (string) e url (string)' }
  }
  // Aceita data URLs (base64) e URLs normais
  if (!obj.url.startsWith('data:') && !obj.url.startsWith('http')) {
    return { valid: false, error: 'URL do arquivo inválida' }
  }
  return { valid: true }
}

function validateAddress(value: unknown): FieldValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { valid: false, error: 'Endereço deve ser um objeto' }
  }
  const obj = value as Record<string, unknown>
  // CEP é o campo principal obrigatório
  if (obj.cep !== undefined && typeof obj.cep !== 'string') {
    return { valid: false, error: 'CEP deve ser texto' }
  }
  // Validar campos são strings
  const addressFields = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado']
  for (const field of addressFields) {
    if (obj[field] !== undefined && typeof obj[field] !== 'string') {
      return { valid: false, error: `Campo '${field}' do endereço deve ser texto` }
    }
  }
  return { valid: true }
}

function validateCpfField(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'CPF deve ser texto' }
  }
  const clean = value.replace(/\D/g, '')
  if (clean.length !== 11) {
    return { valid: false, error: 'CPF deve ter 11 dígitos' }
  }
  if (!validateCPF(clean)) {
    return { valid: false, error: 'CPF inválido' }
  }
  return { valid: true }
}

function validateContentBlock(value: unknown): FieldValidationResult {
  if (value === null || value === undefined || value === '') {
    return { valid: true }
  }
  if (typeof value !== 'string') {
    return { valid: false, error: 'Conteúdo deve ser texto' }
  }
  if (value.length > 50_000) {
    return { valid: false, error: 'Conteúdo excede o limite de 50.000 caracteres' }
  }
  return { valid: true }
}

function validateCalendly(value: unknown): FieldValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Agendamento Calendly deve ser texto' }
  }
  // Aceita URI do evento Calendly ou string "scheduled"
  if (value !== 'scheduled' && !value.startsWith('https://')) {
    return { valid: false, error: 'Valor do agendamento Calendly inválido' }
  }
  return { valid: true }
}
