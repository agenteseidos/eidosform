// lib/sanitize-formula.ts — Prevent CSV/Excel formula injection
// Neutralizes cell values that start with dangerous characters (=, +, -, @, \t, \r, \n)
// by prepending a single quote, which forces spreadsheet apps to treat the value as text.

const DANGEROUS_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n']

/**
 * Sanitizes a single value to prevent formula injection in spreadsheets.
 * Returns the value with a leading single quote if it starts with a dangerous prefix.
 */
export function sanitizeCellValue(value: string): string {
  if (!value) return value
  const firstChar = value[0]
  if (DANGEROUS_PREFIXES.includes(firstChar)) {
    return "'" + value
  }
  return value
}
