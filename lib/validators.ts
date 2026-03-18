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
