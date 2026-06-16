/**
 * Validadores de CPF e CNPJ (validação matemática dos dígitos verificadores)
 * Não consulta a Receita Federal.
 */

/**
 * Valida CPF (Cadastro de Pessoas Físicas).
 * Aceita: 000.000.000-00 ou 00000000000
 */
export function validateCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '')
  if (clean.length !== 11) return false
  if (/^(\d)\1{10}$/.test(clean)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i]) * (10 - i)
  let rem = (sum * 10) % 11
  if (rem === 10 || rem === 11) rem = 0
  if (rem !== parseInt(clean[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * (11 - i)
  rem = (sum * 10) % 11
  if (rem === 10 || rem === 11) rem = 0
  if (rem !== parseInt(clean[10])) return false

  return true
}

/**
 * Valida CNPJ (Cadastro Nacional da Pessoa Jurídica).
 * Aceita: 00.000.000/0000-00 ou 00000000000000
 */
export function validateCNPJ(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '')
  if (clean.length !== 14) return false
  if (/^(\d)\1{13}$/.test(clean)) return false

  const calcDigit = (digits: string, weights: number[]): number => {
    let sum = 0
    for (let i = 0; i < weights.length; i++) sum += parseInt(digits[i]) * weights[i]
    const rem = sum % 11
    return rem < 2 ? 0 : 11 - rem
  }

  const d1 = calcDigit(clean, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  if (d1 !== parseInt(clean[12])) return false

  const d2 = calcDigit(clean, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  if (d2 !== parseInt(clean[13])) return false

  return true
}

/**
 * Formata CPF para exibição: 000.000.000-00
 */
export function formatCPF(cpf: string): string {
  const c = cpf.replace(/\D/g, '').slice(0, 11)
  return c
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

/**
 * Formata CNPJ para exibição: 00.000.000/0000-00
 */
export function formatCNPJ(cnpj: string): string {
  const c = cnpj.replace(/\D/g, '').slice(0, 14)
  return c
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

/**
 * Formata CPF ou CNPJ conforme a quantidade de dígitos digitados:
 * até 11 dígitos → máscara de CPF (000.000.000-00); acima → CNPJ
 * (00.000.000/0000-00). Usado no campo de formulário que aceita ambos.
 */
export function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length <= 11 ? formatCPF(digits) : formatCNPJ(digits)
}

/**
 * Validação "leniente" de URL para campos preenchidos por leigos.
 * Aceita endereços SEM protocolo (ex.: "www.site.com.br", "site.com.br") —
 * o `https://` é assumido por baixo dos panos. Exige apenas que o host
 * pareça um domínio (tenha pelo menos um ponto), pra continuar barrando
 * texto solto. Use em vez de `new URL(value)` cru, que exige protocolo.
 */
export function isValidLooseUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return url.hostname.includes('.') && !url.hostname.startsWith('.') && !url.hostname.endsWith('.')
  } catch {
    return false
  }
}

/**
 * Normaliza uma URL preenchida por leigo adicionando `https://` quando falta
 * o protocolo. Retorna a string original (trim) se já tiver protocolo.
 */
export function normalizeLooseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
