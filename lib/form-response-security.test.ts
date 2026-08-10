import { describe, it, expect } from 'vitest'
import { isResponseComplete } from './form-response-security'

// T14 — o cálculo de `completed` respeita o fix do R7: uma pergunta obrigatória que
// é alvo de salto MAS está oculta por condição não deve bloquear a conclusão da resposta
// (o respondente terminou o sub-fluxo dele). Cobre o endpoint v1 (que usa este helper).
describe('isResponseComplete × salto para alvo oculto (T14)', () => {
  const questions = [
    { id: 'start', type: 'yes_no', required: true,
      jumpRules: [{ id: 'r', condition: { questionId: 'start', operator: 'equals', value: 'pular' },
        action: { type: 'jump', targetQuestionId: 'alvo' } }] },
    { id: 'alvo', type: 'short_text', required: true,
      conditionalLogic: { questionId: 'idade', operator: 'greater_than', value: '18' } },
    { id: 'fim', type: 'short_text', required: true },
  ]

  it('alvo oculto (idade ausente) não é exigido → resposta completa', () => {
    // start='pular' aponta p/ alvo, mas alvo está oculto (sem idade) → fora do caminho;
    // exigir alvo marcaria como incompleta uma resposta que terminou o fluxo.
    const complete = isResponseComplete(
      { start: 'pular', fim: 'ok' },
      questions as unknown as Array<{ id: string; type?: string; required?: boolean }>,
    )
    expect(complete).toBe(true)
  })

  it('alvo visível (idade > 18) e não respondido → resposta incompleta', () => {
    const complete = isResponseComplete(
      { start: 'pular', idade: '30', fim: 'ok' },
      questions as unknown as Array<{ id: string; type?: string; required?: boolean }>,
    )
    expect(complete).toBe(false)
  })
})

/**
 * Bloco de conteúdo marcado como OBRIGATÓRIO (auditoria 2026-08, lote 5).
 *
 * `html_block` e `content_block` são as duas formas de bloco que só EXIBEM conteúdo — nenhum dos
 * dois recebe resposta. Só `content_block` estava excluído da checagem de obrigatoriedade, então
 * um `html_block` com o toggle "obrigatório" ligado deixava a resposta eternamente incompleta.
 *
 * E "incompleta" não é um detalhe cosmético: é o PORTÃO ÚNICO de e-mail ao dono, WhatsApp, Google
 * Sheets, pixel da Meta e webhook do cliente (`app/api/responses/route.ts:625`). Um clique num
 * toggle da barra lateral desligava a captação inteira daquele formulário, em silêncio, e nem
 * recarregar a página resolvia.
 */
describe('isResponseComplete × bloco de conteúdo obrigatório (lote 5)', () => {
  const resposta = { p1: 'João' }

  it('html_block obrigatório NÃO impede a resposta de ser completa', () => {
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'b1', type: 'html_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(true)
  })

  it('content_block obrigatório continua não impedindo (comportamento que já existia)', () => {
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'b1', type: 'content_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(true)
  })

  it('os dois blocos juntos, ambos obrigatórios, ainda deixam completar', () => {
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'b1', type: 'html_block', required: true },
      { id: 'b2', type: 'content_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(true)
  })

  it('REGRESSÃO: pergunta de verdade obrigatória e vazia continua reprovando', () => {
    // O risco da correção é afrouxar demais e passar a considerar completa uma resposta que
    // deixou pergunta obrigatória em branco — aí o dono recebe lead sem o dado que ele exigiu.
    const questions = [
      { id: 'p1', type: 'short_text', required: true },
      { id: 'p2', type: 'email', required: true },
      { id: 'b1', type: 'html_block', required: true },
    ]
    expect(isResponseComplete(resposta, questions)).toBe(false)
  })

  it('formulário SÓ com blocos obrigatórios é completo (não há nada para responder)', () => {
    const questions = [
      { id: 'b1', type: 'html_block', required: true },
      { id: 'b2', type: 'content_block', required: true },
    ]
    expect(isResponseComplete({}, questions)).toBe(true)
  })
})

/**
 * `sanitizeValue` — a limpeza destrutiva (auditoria 2026-08, lote 5).
 *
 * ESTA FUNÇÃO NÃO TINHA UM ÚNICO TESTE, e é ela que passa em TODA resposta de TODO formulário.
 *
 * O defeito: a regra `<[^>]*>` apagava qualquer coisa entre `<` e `>`. Então
 * `<joao@empresa.com>` — o formato que Outlook e Gmail colam — virava string VAZIA. E vazio não
 * dispara erro: a validação trata campo vazio como "ok, obrigatoriedade é checada em outro lugar",
 * a resposta é marcada como INCOMPLETA, e `completed` é o portão ÚNICO de e-mail, WhatsApp,
 * Google Sheets, pixel e webhook. O lead deixava de existir para o dono, e o respondente via a
 * tela de sucesso.
 *
 * Agravante: a resposta fica `completed=false` no banco, então o cron de abandono manda ao dono,
 * meia hora depois, um alerta de "lead abandonou o formulário" com o campo em branco. Ele não fica
 * só sem o lead — fica com um sinal ERRADO sobre o próprio funil.
 *
 * Os três blocos abaixo têm papéis diferentes e nenhum é decorativo:
 *  · REGRESSÃO — falham no código antigo. São o motivo do lote.
 *  · NÃO-REGRESSÃO — passavam antes e precisam continuar passando.
 *  · SEGURANÇA — o que a limpeza existe para barrar. Apertar a regra sem estes vira brecha.
 */
import { sanitizeValue } from './form-response-security'

const limpar = (s: string) => sanitizeValue(s) as string

describe('sanitizeValue — texto legítimo do lead (o defeito do lote 5)', () => {
  it('e-mail entre sinais de menor/maior SOBREVIVE — era o caso que apagava o lead', () => {
    expect(limpar('<joao@empresa.com>')).toBe('<joao@empresa.com>')
    expect(limpar('João Silva <joao@empresa.com>')).toBe('João Silva <joao@empresa.com>')
  })

  it('comparações numéricas sobrevivem', () => {
    for (const t of [
      'ganho < 5k e gasto > 2k',
      'orçamento < R$1.000 > não serve',
      'x<3 e y>4',
      '1 <> 2',
      'preço < 100',
      'a > b',
      '5 < x < 10',
      '<3',
    ]) {
      expect(limpar(t), `"${t}" foi corrompido`).toBe(t)
    }
  })

  it('sinais soltos e acentuação não são tocados', () => {
    expect(limpar('<<>>')).toBe('<<>>')
    expect(limpar('<>')).toBe('<>')
    expect(limpar('São João nº 12 — Aparecida/PB')).toBe('São João nº 12 — Aparecida/PB')
  })

  it('`&amp;` NÃO é mais decodificado — decodificar mutava texto literal sem ganho', () => {
    // A versão antiga da cópia de `lib/` transformava isto em "R$ 100 & R$ 200". Nenhum destino
    // faz parsing depois da limpeza, então decodificar `&amp;`/`&quot;` só alterava o dado do
    // lead — e era a fonte da não-idempotência.
    expect(limpar('R$ 100 &amp; R$ 200')).toBe('R$ 100 &amp; R$ 200')
    expect(limpar('ele disse &quot;oi&quot;')).toBe('ele disse &quot;oi&quot;')
  })

  it('é IDEMPOTENTE — aplicar duas vezes dá o mesmo que aplicar uma', () => {
    // A cópia de `lib/` não era: `&amp;lt;3` dava `&lt;3` na 1ª passada e `<3` na 2ª. Como a
    // limpeza roda em rotas diferentes sobre o mesmo dado (autosave parcial e submit final),
    // isso significava resultado dependente do caminho.
    for (const t of ['<joao@empresa.com>', '&amp;lt;3', '<script>alert(1)</script>', 'a<b>c', '5 < x']) {
      expect(limpar(limpar(t)), `"${t}" não é ponto fixo`).toBe(limpar(t))
    }
  })
})

describe('sanitizeValue — segurança (o que a limpeza existe para barrar)', () => {
  it('tags de script e handlers são removidos', () => {
    expect(limpar('<script>alert(1)</script>')).toBe('alert(1)')
    expect(limpar('<SCRIPT>alert(1)</SCRIPT>')).toBe('alert(1)')
    expect(limpar('<img src=x onerror=alert(1)>')).toBe('')
    expect(limpar('<img\nsrc=x\nonerror=alert(1)>')).toBe('')
    expect(limpar('<iframe src=javascript:alert(1)>')).toBe('')
    expect(limpar('<a href="javascript:alert(1)">x</a>')).toBe('x')
    expect(limpar('<body onload=alert(1)>')).toBe('')
    expect(limpar('<input onfocus=alert(1) autofocus>')).toBe('')
    expect(limpar('<x-custom-el onclick=alert(1)>')).toBe('')
  })

  it('BARRA A BARRA como fim do nome da tag — o furo da primeira proposta', () => {
    // O tokenizer do HTML5 aceita `/` como separador, igual a espaço. Uma regra que só aceitasse
    // `\s` deixaria estes DOIS passarem inteiros — seria abrir uma brecha ao consertar o e-mail.
    expect(limpar('<img/src=x/onerror=alert(1)>')).toBe('')
    expect(limpar('<svg/onload=alert(1)>')).toBe('')
    expect(limpar('<script/xss>alert(1)</script>')).toBe('alert(1)')
  })

  it('ANINHAMENTO não reconstitui tag — o segundo furo', () => {
    // Numa passada só, `<scr<script>ipt>` vira `<script>`: uma tag VIVA que não existia na
    // entrada. Só o laço até ponto fixo fecha isso.
    expect(limpar('<scr<script>ipt>alert(1)</script>')).toBe('alert(1)')
  })

  it('mXSS via math/svg é removido', () => {
    expect(limpar('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>')).toBe('')
  })

  it('entidade HTML nomeada E numérica é decodificada antes de limpar', () => {
    // `&#60;script&#62;` passava INTACTO nas quatro rotas — o trecho que deveria tratar entidade
    // numérica estava dentro de um callback que nunca a capturava. Código morto desde sempre.
    expect(limpar('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)')
    expect(limpar('&#60;script&#62;alert(1)&#60;/script&#62;')).toBe('alert(1)')
    expect(limpar('&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;')).toBe('alert(1)')
  })

  it('INVARIANTE: nenhuma saída contém tag viva, para nenhuma entrada da suíte', () => {
    const entradas = [
      '<script>x</script>', '<img/src=x/onerror=y>', '<scr<script>ipt>x</script>',
      '&lt;script&gt;x&lt;/script&gt;', '&#60;img src=x onerror=y&#62;',
      '<joao@empresa.com>', 'a<b>c', '<<script>>', '<svg/onload=x>',
    ]
    for (const t of entradas) {
      // Nome de tag de verdade = "<" colado numa letra, terminado por espaço, "/" ou ">".
      expect(limpar(t), `"${t}" deixou tag viva`).not.toMatch(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^>]*)?>/)
    }
  })
})

describe('sanitizeValue — estrutura', () => {
  it('percorre array e objeto aninhados sem mudar o formato', () => {
    expect(sanitizeValue({ a: ['<b>x</b>', { c: '<i>y</i>' }] })).toEqual({ a: ['x', { c: 'y' }] })
  })

  it('não mexe em número, booleano, nulo e indefinido', () => {
    expect(sanitizeValue(42)).toBe(42)
    expect(sanitizeValue(true)).toBe(true)
    expect(sanitizeValue(null)).toBe(null)
    expect(sanitizeValue(undefined)).toBe(undefined)
  })
})

/**
 * FALHA FECHADA no aninhamento profundo (regressão pega em ataque adversarial, 07/08/2026).
 *
 * O laço de limpeza descasca UMA camada de aninhamento por passada. Com 6+ camadas ele estourava
 * o teto de 5 e devolvia o texto PARCIALMENTE limpo — com TAG VIVA. Confirmado executando a saída
 * num Chromium headless: `<svg/onload=…>` disparava.
 *
 * A regra ANTIGA devolvia texto inerte no mesmo caso. Ou seja: consertar a perda de lead tinha
 * aberto uma regressão de segurança. Aumentar o teto não resolve — sempre cabe mais uma camada.
 */
describe('sanitizeValue — aninhamento profundo falha FECHADO', () => {
  const temTagViva = (s: string) => /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^>]*)?>/.test(s)

  it('o payload exato que executava no navegador não deixa tag viva', () => {
    const p = '<sv<sv<sv<sv<sv<svg/onload=alert(1)>g/onload=alert(1)>g/onload=alert(1)>'
      + 'g/onload=alert(1)>g/onload=alert(1)>g/onload=alert(1)>'
    expect(temTagViva(limpar(p)), 'voltou a devolver tag viva').toBe(false)
  })

  it('de 2 a 30 camadas de aninhamento — nenhuma deixa tag viva', () => {
    for (let n = 2; n <= 30; n++) {
      const s = '<sv'.repeat(n) + 'g/onload=alert(1)>' + 'g/onload=alert(1)>'.repeat(n - 1)
      expect(temTagViva(limpar(s)), `${n} camadas deixaram tag viva`).toBe(false)
    }
    for (let n = 2; n <= 30; n++) {
      const s = '<scr'.repeat(n) + 'ipt>alert(1)' + '</script>'.repeat(n)
      expect(temTagViva(limpar(s)), `${n} camadas de script deixaram tag viva`).toBe(false)
    }
  })

  it('resposta LEGÍTIMA nunca cai no caminho agressivo — converge de primeira', () => {
    // A rede de segurança não pode voltar a apagar o lead: texto de verdade estabiliza em 1 ou 2
    // passadas e nunca chega no laço de emergência.
    for (const t of ['<joao@empresa.com>', 'ganho < 5k e gasto > 2k', '1 <> 2', '<3', '5 < x < 10']) {
      expect(limpar(t), `"${t}" foi para o caminho agressivo`).toBe(t)
    }
  })
})

/**
 * Entidade numérica de outro caractere (ataque adversarial, 07/08/2026).
 *
 * O `;?` opcional comia o prefixo de qualquer entidade que COMEÇASSE com 60/62: `&#600;` virava
 * `<0;`. Varredura de `&#1;` a `&#70000;` encontrou 2.220 entidades corrompidas.
 *
 * A saída é inerte — não é falha de segurança. Mas INSERE um `<` em texto legítimo de lead, que é
 * exatamente a classe de bug que esta função existe para consertar.
 */
describe('sanitizeValue — entidade numérica vizinha não é corrompida', () => {
  it('&#600; e &#620; ficam intactos; &#60; e &#62; continuam sendo decodificados', () => {
    expect(limpar('char 600 = &#600;')).toBe('char 600 = &#600;')
    expect(limpar('preco &#620; euros')).toBe('preco &#620; euros')
    expect(limpar('&#6000;')).toBe('&#6000;')
    // e o que importa para a segurança continua valendo
    expect(limpar('&#60;script&#62;alert(1)&#60;/script&#62;')).toBe('alert(1)')
    expect(limpar('&#060;script&#062;alert(1)&#060;/script&#062;')).toBe('alert(1)')
  })

  it('varredura: nenhuma entidade de 3+ dígitos começando com 60/62 é tocada', () => {
    for (let n = 600; n <= 629; n++) {
      const t = `x &#${n}; y`
      expect(limpar(t), `&#${n}; foi corrompida`).toBe(t)
    }
  })
})
