import { describe, it, expect } from 'vitest'
import { isValidCpfOrCnpj } from './billing-profile'

describe('isValidCpfOrCnpj', () => {
  it('rejects empty / null / undefined', () => {
    expect(isValidCpfOrCnpj(null)).toBe(false)
    expect(isValidCpfOrCnpj(undefined)).toBe(false)
    expect(isValidCpfOrCnpj('')).toBe(false)
  })

  it('rejects all-equal digits sequences (00000000000, 11111111111)', () => {
    expect(isValidCpfOrCnpj('00000000000')).toBe(false)
    expect(isValidCpfOrCnpj('11111111111')).toBe(false)
    expect(isValidCpfOrCnpj('99999999999')).toBe(false)
  })

  it('accepts a known-good CPF', () => {
    expect(isValidCpfOrCnpj('11144477735')).toBe(true)
  })

  it('rejects a CPF with wrong DV', () => {
    expect(isValidCpfOrCnpj('11144477700')).toBe(false)
  })

  it('accepts CPF with formatting', () => {
    expect(isValidCpfOrCnpj('111.444.777-35')).toBe(true)
  })

  it('accepts a known-good CNPJ', () => {
    expect(isValidCpfOrCnpj('11222333000181')).toBe(true)
  })

  it('rejects a CNPJ with wrong DV', () => {
    expect(isValidCpfOrCnpj('11222333000100')).toBe(false)
  })

  it('rejects all-equal CNPJ', () => {
    expect(isValidCpfOrCnpj('11111111111111')).toBe(false)
  })

  it('rejects strings of unexpected length', () => {
    expect(isValidCpfOrCnpj('123')).toBe(false)
    expect(isValidCpfOrCnpj('123456789012')).toBe(false)
  })
})
