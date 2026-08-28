/**
 * OS TEMAS — contrato visual e promessa de vitrine.
 *
 * Dois temas da marca entraram em 27/08/2026 (`eidos-escuro`, `eidos-claro`), disponíveis a
 * todos os planos. Estes testes travam as três coisas que quebram em silêncio:
 *
 *  1. CONTRASTE. O player pinta o TEXTO do botão principal com `theme.backgroundColor` sobre
 *     `theme.primaryColor` (form-player.tsx). Tema com os dois claros = botão ilegível, e
 *     ninguém percebe até um cliente publicar o formulário.
 *  2. O ENUM DO BANCO. `forms.theme` é `public.theme_preset`, não texto livre. Tema no código
 *     sem `ALTER TYPE` no banco = builder oferece e o save explode em produção.
 *  3. A VITRINE. As landings anunciam a quantidade; a paleta dos mockups já esteve chumbada com
 *     7 hexadecimais que nem batiam com os temas reais.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { themes, themeList, getTheme } from './themes'

/** Luminância relativa (WCAG) — para decidir "claro" x "escuro" sem achismo. */
function luminancia(hex: string): number {
  const m = hex.replace('#', '').match(/.{2}/g)!
  const [r, g, b] = m.map((h) => {
    const c = parseInt(h, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/**
 * DÍVIDA HERDADA, medida em 27/08/2026 e registrada de propósito.
 *
 * Três temas ANTIGOS não alcançam 4.5:1 no botão. NÃO foram corrigidos junto com a entrada dos
 * temas da marca: mudar a cor de um tema muda a aparência de formulários que clientes JÁ
 * publicaram, e isso é decisão do dono, não efeito colateral de outra tarefa.
 *
 * O teto abaixo é o valor MEDIDO de cada um: eles não passam no padrão, mas também não podem
 * PIORAR sem o teste denunciar. Tema novo entra pela régua cheia (4.5), sempre.
 */
const DIVIDA_CONTRASTE: Record<string, number> = {
  midnight: 4.49,  // quase lá — #8B5CF6 sobre #0F0F1A
  sunset: 2.70,    // o pior: botão de leitura difícil
  lavender: 3.69,
}

describe('🛡️ contraste: o botão principal tem de ser legível em TODO tema', () => {
  it.each(themeList.map((t) => [t.name, t] as const))('%s: texto do botão legível sobre o primary', (_n, t) => {
    // O player usa backgroundColor como cor do texto sobre primaryColor. 4.5:1 é o mínimo
    // WCAG AA para texto normal — abaixo disso o cliente publica um botão que não se lê.
    const medido = contraste(t.primaryColor, t.backgroundColor)
    const piso = DIVIDA_CONTRASTE[t.id] ?? 4.5
    expect(medido, `${t.name}: contraste ${medido.toFixed(2)} abaixo do piso ${piso}`)
      .toBeGreaterThanOrEqual(piso - 0.01)
  })

  it('a dívida de contraste não CRESCE — tema novo entra pela régua cheia (4.5)', () => {
    const abaixo = themeList.filter((t) => contraste(t.primaryColor, t.backgroundColor) < 4.5).map((t) => t.id)
    expect(abaixo.sort()).toEqual(Object.keys(DIVIDA_CONTRASTE).sort())
  })

  it.each(themeList.map((t) => [t.name, t] as const))('%s: o texto do formulário é legível sobre o fundo', (_n, t) => {
    expect(contraste(t.textColor, t.backgroundColor)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('🛡️ os temas da marca', () => {
  it('existem, com as cores da landing', () => {
    expect(themes['eidos-escuro']).toMatchObject({
      id: 'eidos-escuro', name: 'Eidos Escuro',
      primaryColor: '#F5B731', backgroundColor: '#0A0A0F', accentColor: '#E8923A',
    })
    expect(themes['eidos-claro']).toMatchObject({
      id: 'eidos-claro', name: 'Eidos Claro',
      primaryColor: '#0A0A0F', backgroundColor: '#FBF7EE', accentColor: '#E8923A',
    })
  })

  it('são 9 no total, e todo id bate com a chave do mapa', () => {
    expect(themeList).toHaveLength(9)
    for (const [chave, t] of Object.entries(themes)) expect(t.id).toBe(chave)
  })

  it('reaproveitam fontes já carregadas pelo layout (sem custo novo de fonte)', () => {
    // DÍVIDA HERDADA (medida em 27/08/2026): o tema `forest` pede "Space Grotesk", que o layout
    // NÃO carrega — ele cai no fallback sans-serif do sistema e nunca teve a fonte anunciada.
    // Registrado em vez de corrigido pelo mesmo motivo do contraste: mexer nisso muda a
    // aparência de formulários publicados. Tema NOVO tem de usar fonte já carregada.
    const FONTE_NAO_CARREGADA = ['forest']
    const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf-8')
    for (const t of themeList) {
      if (FONTE_NAO_CARREGADA.includes(t.id)) continue
      const familia = t.fontFamily.split(',')[0].replace(/'/g, '').trim()
      expect(layout, `fonte "${familia}" (tema ${t.name}) não é carregada no layout`)
        .toContain(familia.replace(/ /g, '_'))
    }
  })
})

describe('🛡️ o ENUM do banco tem de conhecer todo tema do código', () => {
  it('cada tema tem o ALTER TYPE registrado na migration', () => {
    // Regra nº 1: o repo não descreve o banco. Isto guarda o ARQUIVO; só a sonda real prova o
    // banco (feita em 27/08 antes do deploy: PATCH com id inexistente devolveu [] e HTTP 200).
    const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20260827_temas_eidos.sql'), 'utf-8')
    for (const id of ['eidos-escuro', 'eidos-claro']) expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${id}'`)
  })

  it('a união ThemePreset cobre exatamente os temas existentes', () => {
    const types = readFileSync(join(__dirname, 'database.types.ts'), 'utf-8')
    const bloco = types.slice(types.indexOf('export type ThemePreset ='))
    for (const t of themeList) expect(bloco.slice(0, 400)).toContain(`'${t.id}'`)
  })
})

describe('🛡️ a vitrine não promete o que o produto não tem', () => {
  const paginas = ['v3', 'v4'].map((v) => readFileSync(join(__dirname, '..', 'app', v, 'page.tsx'), 'utf-8'))
  const mockups = ['v3', 'v4'].map((v) => readFileSync(join(__dirname, '..', 'components', v, 'section-mockups.tsx'), 'utf-8'))

  it.each([0, 1])('a landing anuncia a quantidade REAL de temas (%i)', (i) => {
    expect(paginas[i]).toContain(`${themeList.length} temas`)
    expect(paginas[i]).not.toMatch(/\b7 temas\b/)
  })

  it.each([0, 1])('a paleta dos mockups sai de themeList, não de cores chumbadas (%i)', (i) => {
    expect(mockups[i]).toContain('themeList.map')
    expect(mockups[i]).not.toContain("'#3b82f6'")  // a lista antiga, que nem batia com os temas
  })
})

describe('🛡️ fallback', () => {
  it('preset desconhecido cai no minimal em vez de quebrar a página', () => {
    expect(getTheme('nao-existe' as never)).toBe(themes.minimal)
  })
})
