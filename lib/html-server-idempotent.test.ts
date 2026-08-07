/**
 * Idempotência do sanitizador de HTML (auditoria 2026-08, lote 2 · L2-1).
 *
 * O defeito: a remoção de tags era de PASSE ÚNICO, e remover uma tag pode CRIAR outra —
 * `<<x>img src=x onerror=...>` vira `<img src=x onerror=...>` intacto, porque o `<x>` some e o
 * `<` órfão se funde com o `img ...>`. Um fuzz de 3.849 variações produziu 992 nós com handler
 * `on*` com UMA passada e zero com duas.
 *
 * Na prática o ataque já não executava — o html_block é sanitizado na escrita E no render, e a
 * CSP com nonce do player impede handler inline de disparar. Mas o caminho de passada única É
 * alcançável (linha legada, ou escrita direta no PostgREST pelo dono), e depender de "duas
 * passadas em lugares diferentes" é frágil: basta alguém remover uma achando que é redundante.
 *
 * Estes testes travam a propriedade que resolve a classe inteira: sanitizar duas vezes tem que
 * dar o mesmo resultado que sanitizar uma.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeEmbedHtml, sanitizeRichHtmlServer } from './html-server'

/**
 * Ficou algum ELEMENTO executável na saída?
 *
 * Exige `<` colado a uma LETRA — que é o que faz o navegador abrir uma tag de verdade.
 * `<<>img src=x onerror=alert(1)>` NÃO cria elemento: `<` seguido de `<` ou de `>` não inicia
 * tag, então o navegador trata tudo como texto e o `onerror` aparece escrito na tela, inerte.
 * Procurar `onerror=` em qualquer posição daria falso positivo justamente nesse caso.
 */
function temElementoExecutavel(html: string): boolean {
  return /<(script|iframe|object|embed|svg)\b/i.test(html) || /<[a-zA-Z][^>]*\son\w+\s*=/i.test(html)
}

const ATAQUES = [
  '<<x>img src=x onerror=alert(document.domain)>',
  '<<x><x>svg onload=alert(1)>',
  '<<x>iframe src="https://evil.com" onload=alert(1)>',
  'texto <<x>img src=x onerror=alert(1)> fim',
  '<<<x>>img src=x onerror=alert(1)>',
  '<<x>script>alert(1)<<x>/script>',
  '<<x>body onload=alert(1)>',
]

describe('sanitizador de HTML — idempotência', () => {
  it.each(ATAQUES)('neutraliza a tag ressuscitada por remoção: %s', (payload) => {
    const saida = sanitizeEmbedHtml(payload)
    expect(temElementoExecutavel(saida)).toBe(false)
  })

  it.each(ATAQUES)('é IDEMPOTENTE — sanitizar 2× é igual a 1×: %s', (payload) => {
    // Esta é a propriedade que resolve a classe toda, não só os payloads listados: se
    // sanitizar de novo não muda nada, nenhuma remoção pode ter criado tag nova.
    const uma = sanitizeEmbedHtml(payload)
    expect(sanitizeEmbedHtml(uma)).toBe(uma)
  })

  it('a variante rich também é idempotente', () => {
    for (const p of ATAQUES) {
      const uma = sanitizeRichHtmlServer(p)
      expect(sanitizeRichHtmlServer(uma)).toBe(uma)
      expect(temElementoExecutavel(uma)).toBe(false)
    }
  })

  it('NÃO ALTERA conteúdo legítimo — a correção não pode custar funcionalidade', () => {
    // Corpus real do produto: embeds de Calendly e YouTube, e formatação de texto rico.
    const legitimos = [
      '<iframe src="https://calendly.com/fulano/30min" width="100%" height="700" frameborder="0"></iframe>',
      '<iframe src="https://www.youtube.com/embed/abc123" title="Vídeo"></iframe>',
      '<p>Texto com <strong>negrito</strong>, <em>itálico</em> e <a href="https://exemplo.com">link</a>.</p>',
      '<ul><li>um</li><li>dois</li></ul>',
      '<p>Sem HTML nenhum, só texto.</p>',
      '',
    ]
    for (const html of legitimos) {
      const uma = sanitizeEmbedHtml(html)
      // idempotente também no caminho feliz...
      expect(sanitizeEmbedHtml(uma)).toBe(uma)
      // ...e o que era permitido continua permitido.
      if (html.includes('calendly') || html.includes('youtube')) {
        expect(uma).toContain('<iframe')
      }
      if (html.includes('<strong>')) {
        expect(uma).toContain('<strong>')
      }
    }
  })

  it('comparativo mecânico: uma passada manual ainda deixaria resíduo que o laço remove', () => {
    // Documenta POR QUE a correção é iterar, não trocar o regex. Com uma passada só, o
    // payload abaixo produz `<img ...>`; o laço até ponto fixo apaga na volta seguinte.
    const saida = sanitizeEmbedHtml('<<x>img src=x onerror=alert(1)>')
    expect(saida).not.toContain('<img')
    expect(saida).not.toContain('onerror')
  })
})
