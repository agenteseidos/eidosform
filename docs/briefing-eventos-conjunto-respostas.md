# Briefing — Feature: Conversão por CONJUNTO de respostas (answer-set events)

> **Para:** sessão do Claude Code no repo `/home/sidney/eidosform` (branch `main`).
> **Escopo:** feature de PRODUTO do EidosForm, para todos os clientes. Nenhuma referência a projeto/cliente específico deve entrar em código, nomes ou testes.
> **Decisor:** Sidney (dono do produto), presente nesta sessão.

## 1. O que é

Hoje o EidosForm dispara eventos de pixel **por resposta individual** (aba Conversões: regra em UMA pergunta → evento na hora da resposta). Esta feature adiciona a camada que falta: **eventos por conjunto de respostas** — o cliente configura *"quando o respondente marcar X na pergunta A, Y na pergunta B e Z na pergunta C (todas, ou pelo menos N delas), dispare o evento W no envio do formulário"*.

Uso típico: funil de captação com tráfego pago. O cliente define o que caracteriza um "lead qualificado" pelo conjunto de respostas e otimiza a campanha (Meta/Google/TikTok) pelo evento que só dispara pra esses leads — sem programador, sem GTM, sem Zapier.

## 2. Benchmark (pesquisado em 2026-07-06)

- **Typeform** trabalha com *lead scoring*: pontos por resposta somados num score, e regras/notificações sobre o total ([lead qualification](https://help.typeform.com/hc/en-us/articles/16908238047892-Lead-qualification-for-small-and-medium-businesses), [score quiz](https://help.typeform.com/hc/en-us/articles/19027676820884-Quiz-and-scoring-what-s-the-difference-between-Outcome-quiz-and-Score-quiz)). A integração com pixel é genérica (rastrear valor dos leads) — **não** dispara evento custom nomeado por regra de conjunto.
- **Tally** ([Meta Pixel integration](https://tally.so/help/facebook-pixel-integration)) e **Fillout/Heyflow** ([comparativo](https://heyflow.com/heyflow-vs-fillout/)) injetam o pixel e têm lógica condicional de navegação, mas não "evento por combinação de respostas" como feature nativa; Heyflow tem CAPI server-side (enterprise).
- **Jotform** tem widget de pixel com eventos genéricos ([widget](https://www.jotform.com/widgets/facebook-pixel)).

**Conclusões de design a partir do benchmark:**
1. O modelo mental consagrado é *scoring com corte* — a nossa regra "pelo menos N das condições" é um scoring simplificado (cada condição = 1 ponto, corte = N). Manter o MVP assim, mas deixar o modelo de dados com espaço pra evoluir pra pesos por condição sem quebra (ver §3).
2. Disparar **evento custom nomeado** por conjunto de respostas é lacuna do mercado → argumento de venda direto ("qualifique leads e alimente o pixel sem programador").
3. Evolução futura natural (NÃO fazer agora): usar o mesmo motor pra variar tela de obrigado/notificações por qualificação, como o Typeform faz com score.

## 3. Modelo de dados

Sem migration — mora no JSONB `forms.pixels` (o `PixelsSchema` tem `.passthrough()`, e o builder preserva chaves extras via spread `{ ...pixels }` — verificado).

```ts
// types/pixel-events.ts
export interface AnswerSetCondition {
  questionId: string
  condition: PixelEventCondition   // { operator, value } — reusa operadores existentes
  // extensão futura (NÃO implementar agora): weight?: number
}

export interface AnswerSetEvent {
  id: string                        // uuid/nanoid gerado pela UI
  name: string                      // nome do evento custom (ex.: "LeadQualificado")
  match: 'all' | 'at_least'
  minMatches?: number               // obrigatório quando match='at_least' (>=1, <= nº de condições)
  conditions: AnswerSetCondition[]  // 1..20
}

// lib/database.types.ts → PixelConfig ganha:
//   answerSetEvents?: AnswerSetEvent[]   // máx. 10 por form
```

## 4. O que já existe no código (reaproveitar, não recriar)

Commit `31dbb06` (hoje) deixou pronto e que **fica**:
- Operadores **`one_of` / `not_one_of`** (lista separada por `|`) em `types/pixel-events.ts`, `lib/pixel-events.ts` (`matchesCondition`, `OPERATOR_LABELS`, `VALUE_OPERATORS`) e no Zod (`PixelEventConditionSchema` em `lib/schemas/form-schema.ts`).
- **`matchesCondition(answer, condition)`** — avaliador pronto (case-insensitive, trata array/numérico/vazio).
- **`fireNamedPixelEvent(name)`** — dispara evento por nome nos 3 destinos (dataLayer/GTM imediato + fbq com retry + ttq com retry) e registra no buffer `__eidosCapturedFbqEvents` (é o que faz o nome do evento ser salvo em `responses.meta_events`).
- Ponto de integração no player: `components/form-player/form-player.tsx`, no submit, ANTES do POST `/api/responses` (comentário "Disparar pixel_event_on_complete ANTES do POST").

E que **sai** (modelo superado — ver §8): `CompletionEventConfig`/`CompletionEventParamRule` (types), `buildCompletionEventParams`/`fireCompletionEventWithParams`/`fireFbqCustomWithParams` (lib), `CompletionEventSchema`/`CompletionEventParamRuleSchema` (Zod), `PixelConfig.completionEvent` (database.types) e o bloco correspondente no submit do player.

## 5. Comportamento no player

Em `form-player.tsx`, no ponto de integração do §4:

```ts
const answerSetEvents = (form.pixels as PixelConfig | null)?.answerSetEvents
for (const ev of answerSetEvents || []) {
  const matched = ev.conditions.filter(c =>
    matchesCondition(finalAnswers[c.questionId], c.condition)).length
  const fires = ev.match === 'all'
    ? matched === ev.conditions.length && ev.conditions.length > 0
    : matched >= Math.max(1, ev.minMatches ?? ev.conditions.length)
  if (fires) fireNamedPixelEvent(ev.name)
}
```

Regras defensivas: condição apontando pra pergunta apagada = não batida (resposta `undefined` não casa `equals`/`one_of`); evento sem condições ou sem nome não dispara; `fireNamedPixelEvent` já cuida de buffer/retry — não duplicar.

## 6. UI no builder (parte principal do trabalho)

Local: `components/form-builder/form-builder.tsx`, aba **Conversões** — mesma região dos pixel IDs e eventos on_start/on_complete (procurar `pixels.metaPixelId`, ~linha 1280). Gate de plano: seguir o padrão da aba (`userPlan === 'plus' || userPlan === 'professional'`).

Nova seção **"Eventos por conjunto de respostas"**:

```
┌─ Eventos por conjunto de respostas ──────────────────────────┐
│ Dispare um evento no envio quando uma combinação de          │
│ respostas indicar, por exemplo, um lead qualificado.         │
│                                                              │
│ ┌─ Evento 1 ──────────────────────────────────── [excluir] ─┐│
│ │ Nome do evento: [ LeadQualificado ]                        ││
│ │ Condições:                                                 ││
│ │  1. [Pergunta ▾] [operador ▾] [valor…]           [x]       ││
│ │  2. [Pergunta ▾] [operador ▾] [valor…]           [x]       ││
│ │  [+ adicionar condição]                                    ││
│ │ Dispara quando: (•) todas as condições baterem             ││
│ │                 ( ) pelo menos [ N ▾] condições baterem    ││
│ └────────────────────────────────────────────────────────────┘│
│ [+ adicionar evento]                                          │
└──────────────────────────────────────────────────────────────┘
```

Diretrizes:
- **Reaproveitar os padrões de `components/form-builder/pixel-branching-editor.tsx`** (editor dos eventos por pergunta): operadores via `OPERATOR_LABELS`, esconder campo de valor quando o operador não usa (`VALUE_OPERATORS`), mesmos componentes shadcn.
- Dropdown de pergunta: perguntas do form (título truncado); excluir tipos sem resposta comparável (`html_block`, blocos de conteúdo).
- **Se a pergunta selecionada for de opções (`select`, `dropdown`, `checkboxes`, `yes_no`)**: no lugar de input livre, multi-select das opções da pergunta que gera `op1|op2|op3` com operador `one_of` — evita erro de digitação do cliente leigo. Input livre continua pros demais tipos/operadores.
- Estado: mesma mecânica da aba (`setPixels({ ...pixels, answerSetEvents: [...] })` + `setHasUnsavedChanges(true)`).
- "Pelo menos N": N limitado entre 1 e o nº de condições do evento.
- Microcopy de ajuda curta explicando o caso de uso (1-2 linhas, tom do produto).

## 7. Validação server-side (Zod)

Em `lib/schemas/form-schema.ts`, dentro do `PixelsSchema`:

```ts
const AnswerSetConditionSchema = z.object({
  questionId: z.string().min(1).max(120),
  condition: PixelEventConditionSchema,   // já existe
}).strip()

const AnswerSetEventSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  match: z.enum(['all', 'at_least']),
  minMatches: z.number().int().min(1).max(20).optional(),
  conditions: z.array(AnswerSetConditionSchema).min(1).max(20),
}).strip()

// no PixelsSchema:
answerSetEvents: z.array(AnswerSetEventSchema).max(10).optional(),
```

## 8. Remoção do modelo `completionEvent` (superado)

O commit `31dbb06` de hoje incluiu um modelo provisório de "evento de conclusão com parâmetros" (`pixels.completionEvent`) sem UI. Decisão do dono do produto: **esta feature (answer-set events) o substitui**; remover o código do modelo antigo nesta mesma sessão (itens listados no §4 como "sai"), mantendo operadores/avaliador/disparador compartilhados.

Nota: pode existir registro de form em produção carregando a chave `completionEvent` no JSONB — após a remoção do código ela vira dado morto e inofensivo (o `PixelsSchema` é passthrough e o player não a lê mais). A migração de configs para o modelo novo é responsabilidade do dono do produto, fora deste briefing. **Não editar forms de produção nesta sessão.**

## 9. Validação E2E

1. `npx tsc --noEmit && npx eslint <arquivos alterados>` limpos.
2. Criar um **form de teste na conta do próprio operador** (via UI do dashboard) com 2-3 perguntas de opções; configurar na aba Conversões um evento de conjunto (ex.: `TesteQualificado`, "pelo menos 2" de 3 condições) e um pixel ID de teste qualquer (numérico).
3. Publicar, abrir o form público com DevTools (aba Rede, filtro "facebook") ou Meta Pixel Helper:
   - Submit com respostas que batem ≥2 condições → requisição `facebook.com/tr` com `ev=TesteQualificado`.
   - Submit batendo ≤1 condição → evento NÃO dispara.
4. Reabrir o form no builder e confirmar que a seção exibe/edita a config salva corretamente (roundtrip UI → banco → UI).
5. Confirmar que o nome do evento aparece em `responses.meta_events` da resposta de teste.
6. Apagar o form de teste ao final.

## 10. Restrições e gotchas do repo

- **NÃO rodar `npm run build` local** (OOM na VPS — SIGKILL na fase TS). Usar `npx tsc --noEmit` + `npx eslint`.
- Deploy = `git push` na `main` (Vercel auto-build; NUNCA `vercel --prod`). Token: `/home/sidney/.eidos-credentials/produtos/github.token` (nunca logar o valor). `git fetch` antes de conclusões sobre o remoto.
- Feature **inerte** pra forms sem `answerSetEvents` — zero mudança pros forms existentes.
- Não tocar em billing/Asaas/webhook (pendências ativas de outra frente — ver CLAUDE.md do repo).
- Há arquivos untracked de outras sessões em `docs/` e `scripts/` — não incluir nos commits.
- Pixel só renderiza pra dono com plano plus/professional (gate em `app/f/[slug]/page.tsx`) — na conta de teste do operador isso já é atendido.

## 11. Relatório final

Reportar: commit(s) com hash, o que foi adicionado/removido, resultado dos testes E2E (§9), e qualquer desvio do briefing com justificativa.

## 12. Adendo (2026-07-06) — correções aceitas antes da implementação (análise Codex, verificada no código)

Sidney aceitou as correções abaixo; a implementação seguiu ESTA versão, não o §5/§7 literais:

1. **Pergunta apagada ≠ condição batida.** `matchesCondition(undefined, …)` retorna `true` para `not_equals`/`not_contains`/`not_one_of`/`is_empty`, então o snippet do §5 geraria falso positivo com condição órfã. O avaliador (`evaluateAnswerSetEvents` em `lib/pixel-events.ts`) recebe o Set de IDs de perguntas existentes e só conta condição de pergunta que ainda existe. Pergunta existente sem resposta avalia normalmente (`is_empty` é legítimo).
2. **Arrays (checkboxes) elemento a elemento.** O `join(', ')` quebrava `equals`/`one_of` com 2+ opções marcadas — exatamente o caminho que a UI gera. `matchesCondition` agora avalia arrays por elemento: positivo casa se ALGUMA opção marcada casar; negativo é a negação exata. `contains` elemento a elemento preserva o editor por pergunta (que usa `contains` pra checkboxes).
3. **Disparo só após POST bem-sucedido.** Os nomes (on_complete + conjuntos) são CALCULADOS antes do POST e entram em `meta_events` direto no payload (determinístico, sem corrida com o buffer/fbq); o disparo nos pixels acontece só depois do `res.ok`. Envio falho não vira conversão. Dedup por `Set` (conjunto homônimo do on_complete dispara 1×). Ressalva aceita: com `redirect_url`, o delay padrão de 2800ms cobre o retry do fbq/ttq.
4. **Zod com validação cruzada.** `AnswerSetEventSchema` tem `superRefine`: `minMatches` obrigatório quando `match='at_least'` e `minMatches ≤ nº de condições`. `name` com `.trim().min(1)`. Runtime conservador para JSONB legado inválido: `minMatches` > condições = nunca dispara.
5. **Extras:** `sanitizeAnswerSetEvents` no save do builder (rascunho incompleto não derruba o save no Zod); testes unitários em `lib/pixel-events.test.ts` (repo já tinha vitest); UI avisa condição órfã (pergunta removida).
