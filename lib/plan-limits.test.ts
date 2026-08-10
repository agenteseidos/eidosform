/**
 * Seleção de formulários ativos no plano com teto (alinhamento Free, 2026-08).
 *
 * A REGRA QUE ESTES TESTES TRAVAM, decidida pelo Sidney: **quem regride para o Free tem que
 * terminar exatamente onde está quem acabou de se cadastrar.** Tudo aqui deriva disso.
 *
 * O que mudou em relação ao comportamento antigo:
 *  · a "peneira dos 100+" foi REMOVIDA. Ela pausava para sempre qualquer formulário com 100+
 *    respostas na VIDA INTEIRA, comparando total histórico com a cota MENSAL da conta. Quem nunca
 *    pagou jamais passa por ela (só roda em quem muda de plano) e pode acumular milhares de
 *    respostas com o formulário no ar — a regra existia só de um lado;
 *  · o teto de PERGUNTAS passou a valer no rebaixamento: quem sempre foi Free nunca consegue ter
 *    um formulário de 40 perguntas, então o rebaixado também não pode manter um rodando.
 */
import { describe, it, expect } from 'vitest'
import { selectActiveForms, type FormSelectionMeta } from './plan-limits'

/** rng determinístico — o desempate aleatório não pode tornar o teste instável. */
const rngFixo = () => 0.5

const form = (id: string, responseCount: number, questionCount = 10): FormSelectionMeta =>
  ({ id, responseCount, questionCount })

describe('selectActiveForms — as vagas', () => {
  it('sobrevivem os MENOS usados; os mais usados caem primeiro', () => {
    // Decisão do Sidney: pausar os mais usados é o que cria pressão real para voltar a pagar.
    const r = selectActiveForms(
      [form('a', 800), form('b', 5), form('c', 300), form('d', 1), form('e', 50)],
      3, 25, rngFixo,
    )
    expect(r.activeIds.sort()).toEqual(['b', 'd', 'e'])
    expect(r.pausedIds.sort()).toEqual(['a', 'c'])
  })

  it('quem tem menos formulários que o teto fica com todos no ar', () => {
    const r = selectActiveForms([form('a', 10), form('b', 20)], 3, 25, rngFixo)
    expect(r.pausedIds).toEqual([])
    expect(r.activeIds.sort()).toEqual(['a', 'b'])
  })

  it('plano ILIMITADO (-1) não pausa nada, nem formulário gigante', () => {
    // Downgrade Professional→Plus não pode pausar formulário nenhum.
    const r = selectActiveForms([form('a', 9999, 180), form('b', 1)], -1, 100, rngFixo)
    expect(r.pausedIds).toEqual([])
    expect(r.activeIds.sort()).toEqual(['a', 'b'])
  })
})

describe('selectActiveForms — a peneira dos 100+ NÃO existe mais', () => {
  it('formulário com 800 respostas fica ATIVO se estiver entre os menos usados', () => {
    // Antes: 800 ≥ 100 → pausado para sempre, sem apelação.
    const r = selectActiveForms([form('a', 800), form('b', 900), form('c', 1000)], 3, 25, rngFixo)
    expect(r.pausedIds).toEqual([])
    expect(r.activeIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('conta em que TODOS passaram de 100 continua com 3 no ar — nunca zero', () => {
    // Este era o pior efeito da peneira: as 3 vagas ficavam VAZIAS porque ninguém chegava a
    // disputá-las. O dono ficava sem nenhum formulário e sem nenhuma ação capaz de reverter.
    const forms = Array.from({ length: 10 }, (_, i) => form(`f${i}`, 500 + i))
    const r = selectActiveForms(forms, 3, 25, rngFixo)
    expect(r.activeIds).toHaveLength(3)
    expect(r.pausedIds).toHaveLength(7)
  })
})

describe('selectActiveForms — o teto de perguntas', () => {
  it('formulário acima do teto de perguntas é pausado mesmo ganhando vaga', () => {
    // Quem sempre foi Free nunca consegue ter 40 perguntas — o rebaixado também não pode manter.
    const r = selectActiveForms(
      [form('anamnese', 1, 40), form('b', 2, 10), form('c', 3, 10)],
      3, 25, rngFixo,
    )
    expect(r.pausedIds).toEqual(['anamnese'])
    expect(r.activeIds.sort()).toEqual(['b', 'c'])
  })

  it('a vaga do formulário grande NÃO passa para o próximo da fila', () => {
    // Ele consumiu a vaga; reduzir as perguntas é o caminho de volta, não perder o lugar.
    const r = selectActiveForms(
      [form('grande', 1, 40), form('b', 2), form('c', 3), form('d', 4)],
      3, 25, rngFixo,
    )
    expect(r.activeIds.sort()).toEqual(['b', 'c'])
    expect(r.pausedIds.sort()).toEqual(['d', 'grande'])
  })

  it('reduzir as perguntas para o teto reativa o formulário', () => {
    const antes = selectActiveForms([form('x', 1, 40), form('y', 2)], 3, 25, rngFixo)
    expect(antes.pausedIds).toEqual(['x'])
    const depois = selectActiveForms([form('x', 1, 25), form('y', 2)], 3, 25, rngFixo)
    expect(depois.pausedIds).toEqual([])
  })

  it('exatamente no teto passa; um a mais não', () => {
    expect(selectActiveForms([form('a', 1, 25)], 3, 25, rngFixo).pausedIds).toEqual([])
    expect(selectActiveForms([form('a', 1, 26)], 3, 25, rngFixo).pausedIds).toEqual(['a'])
  })
})

describe('selectActiveForms — o cenário do Caio, ponta a ponta', () => {
  it('10 formulários, um dos sobreviventes com 40 perguntas → 2 no ar', () => {
    const caio: FormSelectionMeta[] = [
      form('anamnese', 2, 40),      // pouco usado (ganha vaga) mas grande demais
      form('contato', 5),
      form('orcamento', 9),
      ...Array.from({ length: 7 }, (_, i) => form(`campanha${i}`, 100 + i * 50)),
    ]
    const r = selectActiveForms(caio, 3, 25, rngFixo)
    expect(r.activeIds.sort()).toEqual(['contato', 'orcamento'])
    expect(r.pausedIds).toContain('anamnese')
    expect(r.pausedIds).toHaveLength(8)
  })

  it('depois de cortar a anamnese para 25, ele fica com os 3 — igual a quem acabou de cadastrar', () => {
    const caio: FormSelectionMeta[] = [
      form('anamnese', 2, 25),
      form('contato', 5),
      form('orcamento', 9),
      ...Array.from({ length: 7 }, (_, i) => form(`campanha${i}`, 100 + i * 50)),
    ]
    const r = selectActiveForms(caio, 3, 25, rngFixo)
    expect(r.activeIds.sort()).toEqual(['anamnese', 'contato', 'orcamento'])
  })
})

describe('selectActiveForms — determinismo e empate', () => {
  it('é IDEMPOTENTE: rodar de novo sobre o mesmo estado dá o mesmo resultado', () => {
    // Roda no downgrade, ao apagar formulário e ao salvar — não pode oscilar a cada chamada.
    const forms = [form('a', 1), form('b', 2), form('c', 3), form('d', 4)]
    const um = selectActiveForms(forms, 3, 25, rngFixo)
    const dois = selectActiveForms(forms, 3, 25, rngFixo)
    expect(dois.activeIds).toEqual(um.activeIds)
  })

  it('empate é resolvido sem quebrar o teto de vagas', () => {
    const forms = Array.from({ length: 6 }, (_, i) => form(`f${i}`, 10))
    const r = selectActiveForms(forms, 3, 25, () => 0.5)
    expect(r.activeIds).toHaveLength(3)
    expect(r.pausedIds).toHaveLength(3)
    expect(new Set([...r.activeIds, ...r.pausedIds]).size).toBe(6)
  })

  it('nenhum formulário some nem é contado duas vezes', () => {
    const forms = [form('a', 1, 40), form('b', 2), form('c', 3), form('d', 4, 99)]
    const r = selectActiveForms(forms, 2, 25, rngFixo)
    expect([...r.activeIds, ...r.pausedIds].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
