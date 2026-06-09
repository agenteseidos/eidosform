# Briefing — Múltiplas regras + E/OU no editor de condições (EidosForm)

> Documento de implementação. **Status: revisado e validado pelo Codex contra o código real**
> (rodou `npm test -- lib/form-logic-engine.test.ts` → 8/8 passaram). As correções e riscos extras
> que o Codex apontou já estão incorporados abaixo, marcados com **[Codex]**. As perguntas em aberto
> da §9 viraram **decisões fechadas**.
>
> Foco: feature pequena em escopo, mas que mexe em código que roda em produção. Mudança aditiva e
> retrocompatível; navegação do player intocada; backend tem uma ressalva (§8).

---

## 1. O que se quer implementar

Hoje o editor de **condição de visibilidade** de um bloco/pergunta só permite **uma única regra**
(`pergunta` + `operador` + `resposta`). Queremos três coisas:

1. **Múltiplas regras** — botão "+ adicionar condição" para empilhar 2+ linhas de regra.
2. **Conjunção E/OU** — seletor que define se o bloco aparece quando **todas** as regras são
   verdadeiras (E) ou quando **qualquer uma** é (OU). O caso de uso atual usa **E**.
3. **Fall-through quando a condição falha** — quando o bloco não deve aparecer, o motor precisa
   **pular para o próximo destino** e seguir o fluxo, **nunca encerrar o formulário**.

**Achado importante (já investigado):** o item 3 **já funciona corretamente hoje** (ver §3).
Então o trabalho real é só os itens 1 e 2 — sem tocar na navegação.

---

## 2. O sistema hoje (contexto)

- **Stack:** Next.js 16 (App Router) + React 19, Supabase (Postgres + Auth), Tailwind v4, shadcn/ui,
  Framer Motion.
- **Persistência:** cada form é uma linha na tabela `forms`, com o array de perguntas em uma coluna
  **JSONB** (`questions`). **Não há schema rígido por coluna para a lógica** — o formato vive dentro
  do JSON. Isso é central para o risco de retrocompatibilidade (§5).
- **Produção:** há forms publicados e em uso real (inclusive ligados a um fluxo de pagamento e a uma
  campanha de tráfego ativa). Form quebrado = lead/venda perdida silenciosamente. A barra de
  "não regredir" é alta.

### Dois mecanismos de lógica COEXISTEM no mesmo bloco

Isto é essencial entender antes de mexer:

| Mecanismo | Campo | Semântica | Tipo hoje |
|---|---|---|---|
| **Visibilidade** | `conditionalLogic` | "Mostrar este bloco SE..." | objeto único (`ConditionalRule`) |
| **Salto/branching** | `jumpRules` | "Se resposta = X → saltar para Y / submeter" | array (`JumpRule[]`) |

**A feature pedida é só sobre `conditionalLogic` (visibilidade).** `jumpRules` não muda.

### Modelo de dados atual

`lib/database.types.ts`:

```typescript
export type ConditionalOperator =
  | 'equals' | 'not_equals' | 'contains'
  | 'greater_than' | 'less_than' | 'not_empty' | 'is_empty'

export interface ConditionalRule {
  questionId: string
  operator: ConditionalOperator
  value?: string
}

// Em QuestionConfig:
//   conditionalLogic?: ConditionalRule   ← objeto ÚNICO, singular
```

---

## 3. Como a condição falsa se comporta HOJE (já verificado no código)

**Resposta: já faz fall-through. NÃO finaliza o form.** A visibilidade é resolvida por
**filtragem da lista**, não por interrupção do fluxo.

`lib/form-logic-engine.ts`:

```typescript
// linha 59-66 — avalia a regra única do bloco
export function isQuestionVisible(question: QuestionConfig, answers: LogicAnswersMap): boolean {
  const rule = question.conditionalLogic
  if (!rule || !rule.questionId) return true   // condição incompleta → mantém visível
  return evaluateLogicRule(rule, answers)
}

// linha 68-70 — remove da lista quem está com condição falsa
export function getVisibleQuestions(questions: QuestionConfig[], answers: LogicAnswersMap): QuestionConfig[] {
  return questions.filter((question) => isQuestionVisible(question, answers))
}
```

O player navega **sempre dentro da lista já filtrada** (`components/form-player/form-player.tsx`, ~L289-303):

```typescript
const visibleAfterAnswer = getVisibleQuestions(questions, updatedAnswers)
// ...
const idxAfter = visibleAfterAnswer.findIndex(q => q.id === currentQuestion.id)
const next = idxAfter >= 0 ? visibleAfterAnswer[idxAfter + 1] : undefined
if (next) { setCurrentQuestionId(next.id) }   // avança pro próximo VISÍVEL
else { handleSubmit(updatedAnswers) }          // só finaliza se NÃO houver mais nenhum visível
```

Ou seja: bloco com condição falsa **some da lista** e o fluxo segue pro próximo visível.
O form só termina quando, de fato, não há mais nenhum bloco visível depois do atual.
Há teste cobrindo isso em `lib/form-logic-engine.test.ts` (~L10).

**Conclusão:** a navegação/fall-through do **player sequencial** não precisa ser tocada. Ela opera
sobre o *resultado* de `getVisibleQuestions`, independente de quantas regras a visibilidade tenha.

**[Codex] Ressalva importante — afeta backend E player.**
`getNextQuestionId` (`lib/form-logic-engine.ts` L99) retorna `jumpAction.targetQuestionId` **sem
verificar se o alvo está visível**. A navegação imediata do player corrige isso localmente
(`form-player.tsx` L281, ignora salto para alvo oculto), mas `buildQuestionPath` (L114→L99) **não**.
Quem usa `buildQuestionPath` carrega o gap:
- backend: `app/api/responses/route.ts` (L88), `lib/form-response-security.ts` (L37) — cálculo de
  completude.
- **[Codex v2] player também**: progresso e validação em `components/form-player/form-player.tsx`
  (L186, L452) usam o path — então o gap não é só "backend".

**Isso já existe hoje** e não é causado por esta feature — mas múltiplas condições aumentam a
superfície. Decisão fechada na §8.

---

## 4. Arquivos relevantes (mapa rápido)

| Camada | Arquivo | O que muda |
|---|---|---|
| Tipo | `lib/database.types.ts` | `conditionalLogic` passa a aceitar grupo de regras + conjunção |
| Normalizador | `lib/form-logic-engine.ts` (novo helper) | `normalizeConditional()` — fonte única de verdade do formato |
| Schema/validação | `lib/schemas/form-schema.ts` (L114) | **[Codex]** união Zod `ConditionalRule \| ConditionalGroup` — hoje só aceita regra única, formato novo falharia no PATCH/POST |
| Motor | `lib/form-logic-engine.ts` (L59) | `isQuestionVisible` avalia N regras com E/OU |
| Editor (UI) | `components/form-builder/conditional-visibility-editor.tsx` | "+ adicionar condição" + seletor E/OU; **sempre emite `ConditionalGroup`** |
| **[Codex]** Mapa lógico | `lib/logic-graph.ts` (L181) | hoje assume regra única para gerar warnings/labels do diagrama — precisa iterar o grupo |
| **[Codex]** Sanitização builder | `components/form-builder/form-builder.tsx` (L394) | hoje limpa `conditionalLogic.questionId` único — grupo precisa de sanitização própria (dropar linhas incompletas) |
| Testes | `lib/form-logic-engine.test.ts` | casos de E/OU + retrocompat + regra incompleta |
| Navegação player | `components/form-player/form-player.tsx` | **NÃO muda** |
| **[Codex]** Backend path | `app/api/responses/route.ts` (L88), `lib/form-response-security.ts` (L37) | usam `buildQuestionPath`; ver ressalva §3/§8 (gap pré-existente do alvo de salto oculto) |

---

## 5. Riscos identificados (ordenados por gravidade)

**R1 — Retrocompatibilidade do JSONB (CRÍTICO).**
Forms publicados têm `conditionalLogic` como objeto único. Se o tipo virar grupo/array, todo form
já salvo precisa continuar avaliando certo. **Não pode haver migração destrutiva no banco.**
Abordagem proposta: **normalizador na leitura** — objeto-único antigo vira, em runtime, um grupo
de uma regra com conjunção `E`. O banco continua aceitando ambos os formatos; gravações novas usam
o formato novo. *Esse é o ponto onde mais quero a opinião do Codex.*

**R2 — Regras incompletas dentro de um grupo.**
Hoje regra sem `questionId` mantém o bloco visível. Com várias regras é preciso decidir
explicitamente: linha incompleta é **ignorada** (não conta no E/OU) ou **invalida o grupo**?
Proposta: **ignorar linhas incompletas** na avaliação; se *todas* forem incompletas, bloco visível
(igual hoje). Errar isso gera bug "nunca aparece / aparece sempre", difícil de diagnosticar.

**R3 — Condição que referencia resposta ainda não dada.**
`is_empty` retorna `true` para pergunta não respondida. Com `E` de várias regras, o efeito de
piscar/sumir é amplificado. Já existe com 1 regra, mas N regras pioram. Precisa de teste do caso
"condição aponta para pergunta posterior".

**R4 — Dois sistemas paralelos (`conditionalLogic` + `jumpRules`).**
Dar mais poder à visibilidade aumenta a chance de alguém configurar os dois e gerar comportamento
confuso. Não é bug; é UX/clareza no editor.

**R5 — UX para usuário leigo.**
Usuárias finais não são técnicas. "E/OU + N regras" é onde produtos perdem gente. Mitigar com
default `E` pré-selecionado, linguagem natural ("o bloco aparece quando **todas** estas forem
verdadeiras") e, idealmente, preview. **[Codex]** Quando regras incompletas são ignoradas (R2),
o editor precisa avisar explicitamente — texto tipo *"linhas incompletas não são salvas"* —
senão o usuário monta uma regra `OU` esperando que conte e ela some silenciosamente.

**R6 [Codex] — Referência para pergunta deletada.**
O motor não verifica se `questionId` ainda existe. Pior: operadores `not_equals` e `is_empty`
retornam `true` para resposta ausente — então uma regra que aponta para pergunta deletada pode
deixar o bloco **visível por engano**. Com `E` de várias regras isso contamina o grupo todo.
`logic-graph.ts` (L181) já emite warning de "aponta para pergunta que não existe" para a regra
única — esse warning precisa ser estendido para cada regra do grupo.

**R7 [Codex] — `buildQuestionPath` pode incluir alvo de salto oculto.**
Gap pré-existente (detalhado na §3/§8): afeta cálculo de completude da resposta no backend
(`responses/route.ts`, `form-response-security.ts`). Não é introduzido por esta feature, mas é
o momento certo de decidir se corrige junto.

**R8 [Codex] — Pontos de fronteira que assumem regra única.**
Além do motor, o formato é lido/escrito em: `logic-graph.ts` (L181), `form-builder.tsx` (L394,
sanitização), e validado em `form-schema.ts` (L114). **Todos** precisam falar com o formato
normalizado, ou o normalizador precisa rodar em cada fronteira. Esquecer um = bug parcial
(ex.: salva certo mas o diagrama mostra errado).

**R9 [Codex] — Crescimento descontrolado do JSONB/UI.**
Sem limite de regras por grupo, um usuário pode inflar o JSON e a UI. Impor um **máximo de regras
por grupo** (ex.: 10–20, alinhado ao `.max(40)` já usado em `jumpRules`/`pixelEvents` no schema).

---

## 6. Decisões de escopo (fechadas)

**[Codex confirmou] Modelar o tipo já com `conjunction: 'and' | 'or'` desde a v1**, mesmo que a UI
exponha só `and` inicialmente. Isso evita uma segunda mudança de formato no JSONB depois. ✅

**Decisão sobre a UI da v1:** modelar o dado completo (`and`/`or`); a exposição do seletor `OU` na
interface pode entrar na v1 ou ficar para a v1.1 — é decisão de produto, **não** de dados (o dado já
suporta os dois de qualquer forma). Recomendação: como o custo de adicionar o seletor é baixo uma vez
que o motor já avalia os dois, expor `E`/`OU` desde a v1, com `E` como default.

---

## 7. Implementação recomendada (passo a passo)

> Princípio condutor: **mudança aditiva e retrocompatível**, motor e UI atrás do mesmo formato
> normalizado, navegação intocada.

### Passo 0 — Rede de segurança (antes de qualquer mudança)
- Garantir testes atuais passando (`lib/form-logic-engine.test.ts`).
- Adicionar **testes de retrocompat**: um form no formato ANTIGO (`conditionalLogic` objeto único)
  precisa continuar produzindo a mesma `getVisibleQuestions` depois da mudança. Esse teste é o
  guardião do R1.

### Passo 1 — Modelar o tipo (retrocompatível)
Em `lib/database.types.ts`, introduzir o grupo, mantendo `ConditionalRule` como está:

```typescript
export type ConditionalConjunction = 'and' | 'or'

export interface ConditionalGroup {
  conjunction: ConditionalConjunction
  rules: ConditionalRule[]
}

// conditionalLogic aceita os DOIS formatos (união), nunca quebra o antigo:
//   conditionalLogic?: ConditionalRule | ConditionalGroup
```

### Passo 2 — Normalizador único (a peça-chave do R1)
Uma função pura que recebe o valor cru (objeto antigo, grupo novo, ou `undefined`) e devolve sempre
um `ConditionalGroup` canônico. Exportada de `lib/form-logic-engine.ts` para ser reusada em **todas
as fronteiras** (R8):

```typescript
export function normalizeConditional(raw): ConditionalGroup {
  if (!raw) return { conjunction: 'and', rules: [] }
  if ('rules' in raw) return raw                              // já é grupo (formato novo)
  return { conjunction: 'and', rules: [raw] }                 // objeto antigo → grupo de 1 regra
}
```

**[Codex] O normalizador precisa rodar em TODAS as fronteiras que hoje assumem regra única (R8):**
- Motor — `isQuestionVisible` (Passo 3).
- Editor — ao carregar `conditionalLogic` para edição (Passo 5).
- Mapa lógico — `lib/logic-graph.ts` L181, ao gerar warnings/labels por regra (Passo 5b).
- Sanitização do builder — `components/form-builder/form-builder.tsx` L394 (Passo 5c).

Feito isso, o resto do sistema fala **só com `ConditionalGroup`**; ninguém mais precisa saber que
existiu o formato antigo. Leitura sempre normaliza; **escrita sempre grava o formato novo canônico**
(grupo) — a retrocompat é só de leitura.

### Passo 3 — Motor: avaliar N regras com E/OU
Em `lib/form-logic-engine.ts`, reescrever `isQuestionVisible` por cima do normalizador:

```typescript
export function isQuestionVisible(question, answers): boolean {
  const group = normalizeConditional(question.conditionalLogic)
  const valid = group.rules.filter(r => r && r.questionId)   // R2: ignora regras incompletas
  if (valid.length === 0) return true                        // sem condição efetiva → visível
  return group.conjunction === 'or'
    ? valid.some(r => evaluateLogicRule(r, answers))
    : valid.every(r => evaluateLogicRule(r, answers))
}
```

`evaluateLogicRule` (regra individual) **não muda**. `getVisibleQuestions`, navegação e player
**não mudam**.

### Passo 4 — Validação (Zod) — **[Codex] obrigatório, hoje bloqueia o formato novo**
Em `lib/schemas/form-schema.ts` L114, `conditionalLogic` aceita **só** `ConditionalRuleSchema`
(objeto `.strict()`). Sem mudança, **todo PATCH/POST com o formato novo falha na validação.**
Trocar por união aceitando os dois formatos:

```typescript
const ConditionalGroupSchema = z.object({
  conjunction: z.enum(['and', 'or']),
  rules: z.array(ConditionalRuleSchema).max(20),   // R9: limite de regras por grupo
}).strict()

// no QuestionBaseShape:
conditionalLogic: z.union([ConditionalRuleSchema, ConditionalGroupSchema]).optional().nullable(),
```

(Aceita o antigo para forms legados que reenviem o objeto único; grava o novo.)

### Passo 5 — Editor (UI)
Em `components/form-builder/conditional-visibility-editor.tsx`:
- Ao carregar, `normalizeConditional(question.conditionalLogic)` → trabalha sempre com grupo.
- Renderizar a lista de regras (cada uma: pergunta + operador + valor — o componente de linha já
  existe, é só repetir).
- Botão **"+ adicionar condição"** (append em `rules`, respeitando o teto do R9) e botão remover por
  linha.
- Seletor **E/OU**, default `E` (§6).
- **[Codex] `onChange` sempre emite `ConditionalGroup`** — não colapsar para objeto único (R8: evita
  perpetuar a bifurcação de formato).
- **[Codex/R5]** Avisar na UI que linhas incompletas não são salvas.

### Passo 5b — Mapa lógico — **[Codex]**
`lib/logic-graph.ts` L181 hoje lê `q.conditionalLogic.questionId` (regra única) para gerar os
warnings ("sem pergunta escolhida", "aponta para pergunta inexistente") e o label da condição.
Iterar sobre `normalizeConditional(q.conditionalLogic).rules`, emitindo o warning **por regra**
(R6: pergunta deletada precisa ser pega em qualquer regra do grupo).

### Passo 5c — Sanitização do builder — **[Codex]**
`components/form-builder/form-builder.tsx` L394 hoje zera `conditionalLogic` quando
`questionId` está vazio (regra única). Para grupo: **dropar as linhas incompletas** do array; se o
grupo ficar sem nenhuma regra válida, setar `conditionalLogic` como `undefined` (igual hoje).

### Passo 6 — Testes
Adicionar a `lib/form-logic-engine.test.ts`:
- E com 2 regras: visível só quando ambas verdadeiras.
- OU com 2 regras: visível quando qualquer uma verdadeira.
- Regra incompleta ignorada (R2).
- Condição apontando para pergunta posterior / não respondida (R3).
- **Retrocompat:** form antigo (objeto único) avalia idêntico ao comportamento atual (R1).

### Passo 7 — Validação manual em produção (cautela)
Antes/depois de publicar: abrir um form já existente com condição única e confirmar no player que o
comportamento é idêntico. Conferir que o fluxo de pagamento e os forms de campanha ativos seguem ok.

---

## 8. O que NÃO muda — e a ressalva do backend

**Não muda (de propósito):**
- Navegação do **player sequencial** (`form-player.tsx`) — fall-through já correto, opera sobre
  `getVisibleQuestions`.
- `evaluateLogicRule` (avaliação de regra individual) — reusado como está.
- `jumpRules` — mecanismo separado, fora do escopo.
- Schema do banco / migração SQL — abordagem é aditiva em runtime, sem DDL.

**[Codex] Ressalva — `buildQuestionPath` / `getNextQuestionId` (gap pré-existente):**
`getNextQuestionId` (`form-logic-engine.ts` L99) devolve o alvo de um salto **sem checar se ele está
visível**. O player ignora salto para alvo oculto (L281); `buildQuestionPath` não. Como o backend usa
`buildQuestionPath` para medir completude (`responses/route.ts` L88, `form-response-security.ts` L37),
um alvo de salto oculto pode entrar no caminho e distorcer o cálculo de "resposta completa".

**Isto já existe hoje, independe desta feature.**

**[Codex v2] DECISÃO FECHADA: corrigir JUNTO — mas como passo explícito e testado, não "de carona".**
Fazer `getNextQuestionId` pular alvo de salto que não esteja na lista `questions` recebida (já vem
filtrada por visibilidade quando chamada de `buildQuestionPath`). Vira o **passo 8** da §10, com teste
próprio.

**⚠️ Risco confirmado pelo Codex — ler antes:** o fix **muda o cálculo de `completed` para novas
submissões de forms já existentes** (nos dois sentidos): pode virar "incompleta→completa" quando o
path hoje inclui um alvo oculto obrigatório, e "completa→incompleta" quando o path hoje para cedo no
alvo oculto e deixa de exigir perguntas visíveis posteriores. **Registros já salvos não mudam
sozinhos** — só se forem reprocessados pelos endpoints que recalculam `completed`
(`app/api/responses/route.ts` L254, `app/api/v1/forms/[id]/route.ts` L264). Por isso: passo separado,
com teste, e validação manual nos forms de produção antes de publicar.

---

## 9. Decisões (eram perguntas; respondidas pelo Codex)

1. **Normalizador em runtime é suficiente para o R1 — sem migração destrutiva.** Mas ele precisa
   existir nas fronteiras certas: motor, editor, mapa lógico e validação/salvamento (R8). ✅
2. **Modelar `conjunction: 'and' | 'or'` desde a v1** — evita segunda mudança de formato no JSONB. ✅
3. **Ignorar regra incompleta é a melhor decisão** (R2), com uma ressalva: num grupo `OU` com uma
   regra válida falsa + uma incompleta ignorada, o grupo fica falso; se *todas* forem incompletas,
   fica visível. Refletir isso no editor com texto "linhas incompletas não são salvas" (R5). ✅
4. **Riscos extras incorporados:** R6 (pergunta deletada + `not_equals`/`is_empty` → `true`),
   R7 (`buildQuestionPath` com alvo oculto), R8 (fronteiras com regra única: `logic-graph.ts` L181,
   `form-builder.tsx` L394, `form-schema.ts` L114), R9 (limite de regras por grupo). ✅
5. **Editor sempre emite `ConditionalGroup`.** Colapsar para objeto único economiza pouco e perpetua
   a bifurcação; retrocompat é só de leitura/normalização, escrita nova canônica em grupo. ✅

## 10. Sequência de implementação — **[Codex v2] ordem final aprovada**

Reordenada pelo Codex para reduzir risco: a **sanitização do builder vem ANTES do editor** (a UI nova
emite grupo; se a sanitização ainda for de regra única, o autosave persiste lixo ou falha), e o **fix
do R7 entra como passo próprio testado, decidido antes de fechar os testes do motor**.

0. **Rede de segurança:** testes atuais verdes + escrever testes esperados/falhando do motor
   (E, OU, regra incompleta, pergunta deletada R6, retrocompat R1).
1. **Tipo** `ConditionalGroup` + união em `database.types.ts`.
2. **`normalizeConditional()`** exportado de `form-logic-engine.ts`.
3. **Motor:** `isQuestionVisible` com `every`/`some` por cima do normalizador.
4. **Zod união** em `form-schema.ts` L114 (senão o formato novo nem salva) + limite `.max(20)` (R9).
5. **Sanitização do builder** `form-builder.tsx` L394 — dropar linhas incompletas do grupo
   (**antes** do editor, por causa do autosave).
6. **Mapa lógico** `logic-graph.ts` L181 — warnings/labels por regra.
7. **Editor** `conditional-visibility-editor.tsx` — lista de regras + "+ adicionar" + seletor E/OU +
   aviso de linha incompleta; sempre emite `ConditionalGroup`.
8. **Fix do R7** (`getNextQuestionId` pular alvo de salto oculto) **com teste próprio** — ver risco
   de mudança de `completed` na §8.
9. **Validação manual em produção:** abrir form legado com condição única, confirmar comportamento
   idêntico no player; conferir cálculo de `completed`, fluxo de pagamento e forms de campanha ativos.
