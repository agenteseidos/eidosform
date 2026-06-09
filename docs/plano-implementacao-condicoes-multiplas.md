# Plano de implementação — Múltiplas regras + E/OU no editor de condições

> **Plano de execução a nível de código — REVISADO E APROVADO PELO CODEX (análise incorporada).**
> Complementa `docs/briefing-condicoes-multiplas.md` (design + riscos). As decisões de design e de
> implementação estão fechadas. As correções do Codex estão marcadas **[Codex]** ao longo do doc; as
> respostas dele estão consolidadas na §5. **Pronto para implementar pela ordem da §4.**
>
> Principais ajustes da revisão: (a) a estratégia de 2 fases foi corrigida — a canonicalização
> legado→grupo move para a Fase B (2.5-B) e a Fase A ganha um editor read-compat obrigatório (2.7a),
> porque a união de tipo quebra o type-check do editor; (b) normalizer endurecido com
> `Array.isArray`; (c) T13–T15 adicionados à matriz de testes.

---

## 0. Decisões já fechadas (do briefing, não reabrir)
- Tipo modela `conjunction: 'and' | 'or'` desde a v1. Editor expõe E/OU, default `E`.
- Retrocompat é **só de leitura** via `normalizeConditional()`; **escrita sempre canônica (grupo)**.
- Sem migração SQL — abordagem aditiva em runtime.
- Regra incompleta é **ignorada** na avaliação; UI avisa.
- Limite de regras por grupo: `.max(20)`.
- Fix do R7 (`getNextQuestionId` pular alvo de salto oculto) entra **junto**, como passo testado.

---

## 1. Estratégia de deploy em 2 fases — **REVISADA pelo Codex**

Motivação (briefing §"reversão"): se a UI nova salvar um form no formato grupo e depois fizermos
rollback para um deploy que não entende grupo, o motor antigo lê o grupo como "regra sem questionId"
→ bloco sempre visível (regressão silenciosa).

**[Codex] Dois ajustes obrigatórios à divisão original:**
1. **A escrita canônica legado→grupo (passo 2.5) NÃO pode ficar na Fase A.** Todo save passa por
   `questions.map(...)` em `form-builder.tsx:369` e a limpeza atual fica em `form-builder.tsx:394`.
   Se 2.5 (canonicalização) entrar na Fase A, uma regra legada vira grupo no próximo autosave →
   a Fase A passa a **escrever grupo**, e reverter a *própria Fase A* para o deploy antigo fica
   inseguro. **Solução: na Fase A a sanitização PRESERVA o formato legado; a canonicalização
   legado→grupo vai para a Fase B.**
2. **Mudar `conditionalLogic` para união (2.1) quebra o type-check do editor** em
   `conditional-visibility-editor.tsx:12,32,53,54,61,70,80,89` (tipa `onChange` como `ConditionalRule`
   e acessa campos diretos). **Então a Fase A PRECISA incluir uma adaptação mínima do editor** para
   *ler* grupo (via `normalizeConditional`) e continuar *emitindo regra única legada* — sem UI de
   múltiplas regras. Sem isso o build não fecha. O editor multi-regra completo (emite grupo) fica
   na Fase B.

**Divisão final:**
- **Fase A — lado leitura (1 deploy):** type union + normalizer + motor + Zod + logic-graph +
  **editor mínimo (lê grupo, emite legado)** + sanitização **preservando legado**. Ensina o sistema
  a **ler/aceitar** grupo; **nada escreve grupo**. 100% retrocompatível, rollback seguro nos dois
  sentidos.
- **Fase A.5 — fix do R7 (deploy isolado):** muda cálculo de `completed` (briefing §8) → commit
  separado pra reverter sem mexer no resto. **[Codex confirmou]** o risco e o isolamento.
- **Fase B — lado escrita (1 deploy):** editor multi-regra (emite grupo) + canonicalização
  legado→grupo. Agora grupos são escritos; rollback pra Fase A é seguro (A já lê grupo).

---

## 2. Passos com diffs concretos

### 2.0 — Rede de segurança
- `npm test` atual verde (8/8 em `lib/form-logic-engine.test.ts`).
- Escrever **primeiro** os testes novos do motor (falhando), depois implementar (passo 2.3).

### 2.1 — Tipo (`lib/database.types.ts`, ~L37-44, L99)

```diff
 export type ConditionalOperator = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'not_empty' | 'is_empty'

 export interface ConditionalRule {
   questionId: string
   operator: ConditionalOperator
   value?: string
 }
+
+export type ConditionalConjunction = 'and' | 'or'
+
+export interface ConditionalGroup {
+  conjunction: ConditionalConjunction
+  rules: ConditionalRule[]
+}
```
```diff
-  conditionalLogic?: ConditionalRule
+  conditionalLogic?: ConditionalRule | ConditionalGroup   // legado (objeto) ou novo (grupo)
```

### 2.2 — Normalizador (`lib/form-logic-engine.ts`, novo export)

```ts
import { ConditionalRule, ConditionalGroup, QuestionConfig } from '@/lib/database.types'

export function normalizeConditional(
  raw: ConditionalRule | ConditionalGroup | null | undefined,
): ConditionalGroup {
  if (!raw) return { conjunction: 'and', rules: [] }
  // [Codex] dado vem de JSON/DB sem validação na leitura do motor — discriminar por
  // Array.isArray(rules), não por 'in'. Objeto malformado {rules: ...} sem conjunction
  // seria tratado como grupo se usássemos 'rules' in raw.
  if (Array.isArray((raw as ConditionalGroup).rules)) {
    const g = raw as ConditionalGroup
    return { conjunction: g.conjunction === 'or' ? 'or' : 'and', rules: g.rules }   // conjunção inválida → 'and'
  }
  return { conjunction: 'and', rules: [raw as ConditionalRule] }   // objeto legado → grupo de 1 regra
}
```
> **[Codex]** `Array.isArray(rules)` é mais robusto que `'rules' in raw` (dado não-validado do DB), e
> a conjunção inválida cai para `'and'`.

### 2.3 — Motor (`lib/form-logic-engine.ts`, L59-66 reescrito)

```diff
-export function isQuestionVisible(question: QuestionConfig, answers: LogicAnswersMap): boolean {
-  const rule = question.conditionalLogic
-  if (!rule || !rule.questionId) return true
-  return evaluateLogicRule(rule, answers)
-}
+export function isQuestionVisible(question: QuestionConfig, answers: LogicAnswersMap): boolean {
+  const group = normalizeConditional(question.conditionalLogic)
+  const valid = group.rules.filter((r) => r && r.questionId)   // R2: ignora regra incompleta
+  if (valid.length === 0) return true                          // sem condição efetiva → visível
+  return group.conjunction === 'or'
+    ? valid.some((r) => evaluateLogicRule(r, answers))
+    : valid.every((r) => evaluateLogicRule(r, answers))
+}
```
- `evaluateLogicRule` (L27) **não muda**. `getVisibleQuestions`, `buildQuestionPath`, player **não mudam**.
- `evaluateConditionalRule` (L132, export legado) — manter por compat; verificar se há chamadores
  externos. (Codex: confirmar se pode ser deprecado.)

### 2.4 — Validação Zod (`lib/schemas/form-schema.ts`, L48-54 + L114)

```diff
 const ConditionalRuleSchema = z
   .object({
     questionId: z.string(),
     operator: z.enum([...]),
     value: z.string().max(2000).optional().nullable(),
   })
   .strict()
+
+const ConditionalGroupSchema = z
+  .object({
+    conjunction: z.enum(['and', 'or']),
+    rules: z.array(ConditionalRuleSchema).max(20),   // R9: limite por grupo
+  })
+  .strict()
+
+const ConditionalLogicSchema = z.union([ConditionalGroupSchema, ConditionalRuleSchema])
```
```diff
-  conditionalLogic: ConditionalRuleSchema.optional().nullable(),
+  conditionalLogic: ConditionalLogicSchema.optional().nullable(),
```
> `.strict()` nos dois discrimina limpo: grupo tem chaves extras p/ o rule schema e vice-versa.
> **Sem esta mudança, todo PATCH/POST com grupo falha na validação.**

### 2.5 — Sanitização do builder (`components/form-builder/form-builder.tsx`, L394) — **SPLIT em 2 fases [Codex]**

Hoje zera `conditionalLogic` se `questionId` vazio (regra única). O save passa por `questions.map(...)`
em L369; a limpeza fica em L394.

**Fase A — preservar legado (NÃO canonizar):** apenas tolerar grupo e dropar regras incompletas,
**sem converter legado→grupo** (senão a Fase A escreve grupo e perde o rollback seguro). Se a entrada
for legado, sai legado; se já for grupo (só apareceria em Fase B+), filtra as regras incompletas.

```diff
-      if (next.conditionalLogic && !next.conditionalLogic.questionId) {
-        next = { ...next, conditionalLogic: undefined }
-      }
+      if (next.conditionalLogic) {
+        const cl = next.conditionalLogic
+        if (Array.isArray((cl as ConditionalGroup).rules)) {
+          // grupo: dropa incompletas, mantém grupo (ou undefined se zerar)
+          const rules = (cl as ConditionalGroup).rules.filter((r) => r && r.questionId)
+          next = { ...next, conditionalLogic: rules.length ? { ...(cl as ConditionalGroup), rules } : undefined }
+        } else if (!(cl as ConditionalRule).questionId) {
+          next = { ...next, conditionalLogic: undefined }   // legado incompleto → zera (igual hoje)
+        }
+      }
```

**Fase B — canonizar legado→grupo:** na Fase B, quando a UI já emite grupo, trocar o ramo legado
para normalizar tudo em grupo canônico:
```diff
-        } else if (!(cl as ConditionalRule).questionId) {
-          next = { ...next, conditionalLogic: undefined }
+        } else {
+          const group = normalizeConditional(cl)
+          const rules = group.rules.filter((r) => r && r.questionId)
+          next = { ...next, conditionalLogic: rules.length ? { conjunction: group.conjunction, rules } : undefined }
        }
```

### 2.6 — Mapa lógico (`lib/logic-graph.ts`, L181-188)

Hoje lê `q.conditionalLogic.questionId` (regra única) p/ warnings + `conditionText`. Iterar o grupo:

```diff
-    if (q.conditionalLogic) {
-      if (!q.conditionalLogic.questionId) {
-        nodeWarnings.push({ severity: 'warning', message: 'Condição de exibição sem pergunta escolhida — será ignorada.' })
-      } else if (!byId.has(q.conditionalLogic.questionId)) {
-        nodeWarnings.push({ severity: 'error', message: 'Condição de exibição aponta para uma pergunta que não existe mais.' })
-      } else {
-        conditionLabel = conditionText(q.conditionalLogic, questions, true)
-      }
-    }
+    const condGroup = normalizeConditional(q.conditionalLogic)
+    if (condGroup.rules.length > 0) {
+      const labels: string[] = []
+      for (const rule of condGroup.rules) {
+        if (!rule.questionId) {
+          nodeWarnings.push({ severity: 'warning', message: 'Condição de exibição sem pergunta escolhida — será ignorada.' })
+        } else if (!byId.has(rule.questionId)) {   // R6: pergunta deletada, por regra
+          nodeWarnings.push({ severity: 'error', message: 'Condição de exibição aponta para uma pergunta que não existe mais.' })
+        } else {
+          labels.push(conditionText(rule, questions, true))
+        }
+      }
+      if (labels.length) {
+        const sep = condGroup.conjunction === 'or' ? ' OU ' : ' E '
+        conditionLabel = labels.join(sep)
+      }
+    }
```
`conditionText` (L91) já recebe uma regra única — não muda.

### 2.7a — Editor mínimo (`conditional-visibility-editor.tsx`) — **FASE A (read-compat) [Codex]**

**Obrigatório na Fase A** (senão o build quebra com a união de tipo): adaptar o editor para *ler*
grupo sem criar UI de múltiplas regras.
- `onChange` passa a tipar `ConditionalRule | ConditionalGroup | undefined` (compatível com a união),
  mas **continua emitindo regra única legada** (`ConditionalRule`/`undefined`) — nenhum grupo é escrito.
- No topo: `const group = normalizeConditional(question.conditionalLogic)` e o componente opera sobre
  `group.rules[0]` (a única regra), exatamente como hoje. Os acessos diretos a `rule.questionId/operator/value`
  (L32,53,54,61,70,80,89) passam a ler de `group.rules[0]`.
- Visual e comportamento **idênticos ao atual** — é só compat de tipo. Zero mudança observável.

### 2.7b — Editor completo (`conditional-visibility-editor.tsx`) — **FASE B**

Agora sim a UI de múltiplas regras. `onChange(group: ConditionalGroup | undefined)`. Os 2 chamadores
em `question-editor.tsx` (L58, L338) passam `(conditionalLogic) => onUpdate({ conditionalLogic })` —
seguem funcionando, só muda o tipo do payload.

Estrutura nova:
- `const group = normalizeConditional(question.conditionalLogic)` no topo.
- Estado vazio (sem regras): "Sempre visível" + botão "Definir condição" → emite
  `{ conjunction: 'and', rules: [{ questionId: '', operator: 'equals', value: '' }] }`.
- Com regras: renderizar `group.rules.map(...)` — cada linha é o bloco atual (select pergunta +
  select operador + input/select valor) + botão remover **por linha**
  (`onChange({ ...group, rules: rules.filter((_, i) => i !== idx) })`; se zerar → `undefined`).
- Entre as linhas (a partir da 2ª): seletor **E/OU** controlando `group.conjunction`.
- Rodapé: botão **"+ adicionar condição"** (append em `rules`, desabilitado em `rules.length >= 20`).
- **R5:** texto fixo "Linhas sem pergunta não são salvas".
- Helpers `OPERATORS`, `questionLabel`, `isChoiceType`/`answerOptions` reusados como estão.

### 2.8 — Fix do R7 (`lib/form-logic-engine.ts`, L99) — **DEPLOY ISOLADO**

```diff
   if (jumpAction?.type === 'submit') return null
   if (jumpAction?.type === 'jump' && jumpAction.targetQuestionId) {
-    return jumpAction.targetQuestionId
+    // Só salta se o alvo está na lista recebida. Em buildQuestionPath a lista já vem
+    // filtrada por visibilidade, então alvo oculto cai no sequencial (não some o fluxo).
+    if (questions.some((q) => q.id === jumpAction.targetQuestionId)) {
+      return jumpAction.targetQuestionId
+    }
   }
```
> **[Codex] Não-regressão confirmada:** com lista **completa**, alvo existente → `some(...)` true →
> idêntico ao atual. Único chamador interno: `buildQuestionPath` (L114-126, lista filtrada ✓) e o
> wrapper `lib/conditional-engine.ts` (L61-66; grep não achou uso interno). Player já equivalente
> (`form-player.tsx` L280-288, só salta se alvo ∈ `visibleAfterAnswer`).
> **⚠️ [Codex] Exceção — alvo órfão/deletado:** NÃO é idêntico mesmo com lista "completa": antes
> retornava o id inexistente; depois cai no sequencial. É provavelmente correção boa, mas o **T11**
> deve dizer explicitamente "alvo **existente** na lista completa" para não confundir com esse caso.
> **[Codex] Risco de `completed` confirmado:** `responses/route.ts` (L84-101 calcula via
> `buildQuestionPath`, L253-254 usa) e o endpoint **v1** via helper compartilhado
> `form-response-security.ts` (L29-48), usado em `app/api/v1/forms/[id]/route.ts` (L264). Deploy
> isolado + teste dos dois sentidos + validação manual.

---

## 3. Matriz de testes (`lib/form-logic-engine.test.ts` + novos)

| # | Caso | Risco | Esperado |
|---|---|---|---|
| T1 | Grupo `and`, 2 regras, ambas verdadeiras | core | visível |
| T2 | Grupo `and`, 1 verdadeira + 1 falsa | core | oculto |
| T3 | Grupo `or`, 1 verdadeira + 1 falsa | core | visível |
| T4 | Grupo `or`, 2 falsas | core | oculto |
| T5 | Regra incompleta (sem questionId) ignorada num grupo `and` válido | R2 | avalia só as válidas |
| T6 | Todas as regras incompletas | R2 | visível |
| T7 | **Retrocompat:** form legado (objeto único) idêntico ao comportamento atual | R1 | igual ao baseline |
| T8 | `normalizeConditional` p/ objeto / grupo / undefined | core | grupo canônico |
| T9 | Regra aponta p/ pergunta deletada — `is_empty`/`not_equals` retornam true | R6 | documentar comportamento + warning no logic-graph |
| T10 | **R7:** salto cujo alvo está oculto por condição não entra em `buildQuestionPath` | R7 | path pula o alvo oculto |
| T11 | **R7 não-regressão:** `getNextQuestionId` com lista completa, **alvo existente** → salta normal | R7 | idêntico ao atual |
| T12 | Zod aceita objeto legado e grupo; rejeita grupo com 21 regras | R9 | validação ok/erro |
| **T13 [Codex]** | `logic-graph` (L181-188): grupo c/ múltiplas regras → label com E/OU; warning por regra incompleta; erro por pergunta deletada | R6/R8 | warnings/label corretos |
| **T14 [Codex]** | `completed` via `lib/form-response-security.ts` (L29-48) com salto p/ alvo oculto | R7 | path correto (cobre o endpoint v1) |
| **T15 [Codex]** | normalizer endurecido: `{rules:[]}` sem conjunction → `'and'`; conjunção inválida → `'and'` | core | grupo canônico |

---

## 4. Ordem de execução (commits) — **REVISADA [Codex]**

**Fase A — lê grupo, NÃO escreve (1 deploy):**
2.0 → 2.1 (type union) → 2.2 (normalizer endurecido) → 2.3 (motor) → 2.4 (Zod) →
**2.5-A (sanitização preservando legado)** → 2.6 (logic-graph) → **2.7a (editor read-compat)**.
Testes: T1–T9, T12, T13, T15. **Critério:** `npm run build` fecha (type-check OK) + nenhum grupo é
escrito no DB. Rollback seguro nos dois sentidos.

**Fase A.5 — fix R7 (deploy isolado):** 2.8 + T10, T11, T14. (Muda `completed`.)

**Fase B — escreve grupo (1 deploy):** **2.7b (editor multi-regra)** + **2.5-B (canonização
legado→grupo)** + validação manual em produção (form legado, cálculo de `completed`, pagamento,
campanhas ativas).

> **[Codex]** As mudanças vs. plano original: (a) 2.5 vira 2.5-A/2.5-B; (b) 2.7 vira 2.7a (Fase A,
> obrigatório p/ o build) + 2.7b (Fase B); (c) normalizer endurecido; (d) T13–T15 adicionados.

---

## 5. Análise do Codex (eram perguntas; respondidas e incorporadas)

1. **Rollback / 2 fases:** o plano original estava furado — a sanitização canônica (2.5) escreveria
   grupo já na Fase A (autosave via `form-builder.tsx:369/394`), quebrando "Fase A não escreve" e o
   rollback da própria Fase A. **Corrigido:** 2.5 split (A preserva legado / B canoniza). Além disso,
   a união de tipo (2.1) quebra o type-check do editor → **Fase A precisa do editor read-compat
   (2.7a)**. ✅ incorporado.
2. **Fix R7:** idêntico p/ alvo existente em lista completa; único chamador `buildQuestionPath`
   (filtrada) + wrapper sem uso interno; player já equivalente. **Exceção:** alvo órfão/deletado muda
   (cai no sequencial) → T11 especifica "alvo existente". Risco de `completed` confirmado
   (`responses/route.ts`, `form-response-security.ts`, endpoint v1). ✅
3. **`'rules' in raw` / Zod:** trocar por `Array.isArray(rules)` + normalizar conjunção inválida
   (dado do DB não é validado na leitura do motor). `z.discriminatedUnion` **não se aplica** (não há
   campo discriminante literal; `rules` é diferença estrutural). `z.union` com dois `.strict()`,
   grupo primeiro, é robusta. PATCH/POST passam por `FormUpdateSchema`/`FormCreateSchema.safeParse`
   (`forms/[id]/route.ts:89-97`, `forms/route.ts:85-93`). ✅
4. **Sanitização Fase A:** confirmado — mover canonicalização p/ Fase B. ✅ (ver item 1)
5. **Faltava na matriz:** (a) testes de `logic-graph` (T13); (b) teste de `completed` via
   `form-response-security.ts` + endpoint v1 (T14); (c) normalizer endurecido (T15).
   **Oportunidade de limpeza apontada pelo Codex:** há `isResponseComplete` **duplicado** em
   `responses/route.ts:84-101` vs. o helper único `form-response-security.ts:29-48` — considerar
   **remover a duplicação** e usar só o helper (fora do escopo mínimo, mas reduz risco de divergência).
   `evaluateConditionalRule` (L132) e o wrapper `conditional-engine.ts` **não quebram o build**
   (seguem aceitando `ConditionalRule`); sem chamadores externos. ✅
