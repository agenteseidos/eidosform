export interface Country {
  code: string
  name: string
  dial: string
  flag: string
  format: string
}

export const countries: Country[] = [
  { code: 'BR', name: 'Brasil', dial: '+55', flag: '🇧🇷', format: '(00) 00000-0000' },
  { code: 'US', name: 'Estados Unidos', dial: '+1', flag: '🇺🇸', format: '(000) 000-0000' },
  { code: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹', format: '000 000 000' },
  { code: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷', format: '(00) 0000-0000' },
  { code: 'CO', name: 'Colômbia', dial: '+57', flag: '🇨🇴', format: '000 000 0000' },
  { code: 'MX', name: 'México', dial: '+52', flag: '🇲🇽', format: '00 0000 0000' },
  { code: 'CL', name: 'Chile', dial: '+56', flag: '🇨🇱', format: '0 0000 0000' },
  { code: 'ES', name: 'Espanha', dial: '+34', flag: '🇪🇸', format: '000 00 00 00' },
  { code: 'GB', name: 'Reino Unido', dial: '+44', flag: '🇬🇧', format: '0000 000000' },
  { code: 'DE', name: 'Alemanha', dial: '+49', flag: '🇩🇪', format: '000 00000000' },
  { code: 'FR', name: 'França', dial: '+33', flag: '🇫🇷', format: '0 00 00 00 00' },
  { code: 'IT', name: 'Itália', dial: '+39', flag: '🇮🇹', format: '000 000 0000' },
  { code: 'JP', name: 'Japão', dial: '+81', flag: '🇯🇵', format: '00-0000-0000' },
]

export function getCountryByCode(code: string): Country {
  return countries.find(c => c.code === code) || countries[0]
}
