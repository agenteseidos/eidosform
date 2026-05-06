/**
 * lib/cpf-cnpj.ts — Validação de CPF e CNPJ (DV checksum) — pura, sem deps.
 * Pode ser importada de qualquer lugar (server, client, edge).
 */

function digitsOnly(value: string | null | undefined) {
  return value ? value.replace(/\D/g, '') : ''
}

function isValidCpf(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const digits = cpf.split('').map(Number)
  const calc = (slice: number) => {
    let sum = 0
    for (let i = 0; i < slice; i++) sum += digits[i] * (slice + 1 - i)
    const mod = (sum * 10) % 11
    return mod === 10 ? 0 : mod
  }
  return calc(9) === digits[9] && calc(10) === digits[10]
}

function isValidCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false
  const digits = cnpj.split('').map(Number)
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const calc = (weights: number[]) => {
    let sum = 0
    for (let i = 0; i < weights.length; i++) sum += digits[i] * weights[i]
    const mod = sum % 11
    return mod < 2 ? 0 : 11 - mod
  }
  return calc(weights1) === digits[12] && calc(weights2) === digits[13]
}

export function isValidCpfOrCnpj(value: string | null | undefined): boolean {
  const digits = digitsOnly(value)
  if (!digits) return false
  if (digits.length === 11) return isValidCpf(digits)
  if (digits.length === 14) return isValidCnpj(digits)
  return false
}
