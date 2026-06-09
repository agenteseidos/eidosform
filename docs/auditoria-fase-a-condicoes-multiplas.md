# Auditoria — Fase A da feature de condições múltiplas (E/OU)

> **Para o Codex auditar.** Você já revisou o **plano** (`docs/plano-implementacao-condicoes-multiplas.md`,
> §4 Fase A) e o **design** (`docs/briefing-condicoes-multiplas.md`). Esta é a **implementação real da
> Fase A**, no branch `feat/condicoes-multiplas-e-ou` (working tree, ainda NÃO commitado). Audite o diff
> abaixo contra o código real do repo. Não implemente — aponte bugs/riscos.

## Contexto: o que é a Fase A
Feature: editor de visibilidade do EidosForm passa a suportar **múltiplas regras + E/OU**. Para rollback
limpo, dividimos em fases. **Fase A = lado leitura:** o sistema passa a **ler/aceitar** o formato de grupo,
mas **a UI não escreve grupo** (editor segue emitindo regra única; sanitização preserva legado). Logo,
**comportamento observável é idêntico ao atual.**

> **[Auditoria Codex — precisão do invariante]** "Nenhum grupo chega ao banco" é forte demais: o Zod das
> rotas de create/update (`form-schema.ts:68/128`) **aceita** `ConditionalGroup` e as rotas persistem
> `questions` como vêm (`app/api/forms/route.ts:151/160`, `app/api/forms/[id]/route.ts:297/314`). **A UI
> não escreve grupo, mas um cliente de API direta poderia.** Aceitar grupo no Zod é **proposital** (é o
> que torna o rollback da Fase B→A seguro). Resíduo: rollback da Fase A→`main` só é inseguro se um grupo
> tiver sido persistido via API direta — o que nenhum cliente real faz (o formato grupo não existia antes;
> nenhum cliente o conhece). Risco residual aceito.

## Verificação já feita por mim
- `tsc --noEmit` (projeto inteiro) → **exit 0**.
- Testes alvo (engine + logic-graph + schema) → **31/31 verdes** (T1–T8, T12, T13, T15 do plano).
- Suíte do projeto → **95 passes, 0 falhas reais** (resto é ruído pré-existente: cópias de
  `proration.test.ts` com `process.exit` + testes de terceiros em `services/whatsapp/node_modules`).

## Invariantes da Fase A que quero que você confirme
1. **Nada escreve grupo.** O editor (`conditional-visibility-editor.tsx`) emite só `ConditionalRule | undefined`,
   e a sanitização (`form-builder.tsx`) preserva o formato de entrada (legado→legado). Existe ALGUM caminho
   no diff onde um `ConditionalGroup` poderia ser persistido na Fase A?
2. **Comportamento idêntico ao legado.** Para uma `ConditionalRule` única, `isQuestionVisible` novo é
   equivalente ao antigo? (`valid.length === 0 → true` cobre o antigo `!rule.questionId → true`?)
3. **Rollback seguro nos dois sentidos** garantido por (1)?

## Perguntas específicas de auditoria
A. **`normalizeConditional`** (`form-logic-engine.ts`): a discriminação por `Array.isArray((raw as ...).rules)`
   é robusta para dado de JSONB não-validado? Ela **retorna `group.rules` por referência** (não copia) — há
   risco de mutação acidental rio abaixo (ex.: `isQuestionVisible` faz `.filter`, que é cópia — ok; mas e os
   outros consumidores)?
B. **Consumidores diretos de `conditionalLogic`** fora dos arquivos tocados: faça grep e confirme se alguém
   lê `.questionId/.operator/.value` **sem** passar por `normalizeConditional`. Em Fase A não há grupo no
   banco, mas mapear isso agora evita bug na Fase B. Em especial: `evaluateConditionalRule`
   (`form-logic-engine.ts`, ainda tipado p/ `ConditionalRule`), o wrapper `lib/conditional-engine.ts`, e
   qualquer render/serialização.
C. **Zod** (`form-schema.ts`): a `z.union([ConditionalGroupSchema, ConditionalRuleSchema])` com os dois
   `.strict()` discrimina certo? Uma regra única legada nunca é aceita como grupo malformado e vice-versa?
   `null`/`undefined` seguem válidos? O `.max(20)` é o limite desejado (vs `.max(40)` de jump/pixel)?
D. **logic-graph** (`logic-graph.ts`): para o caso legado (1 regra), o `conditionLabel` final é idêntico ao
   de antes (sem `E`/`OU` espúrio)? Os warnings por regra não duplicam nem somem em relação ao comportamento
   anterior?
E. **form-builder sanitização**: o ramo `Array.isArray(...rules)` só dispara se já houver grupo (não ocorre
   em Fase A). O ramo legado (`!questionId → undefined`) é idêntico ao comportamento anterior? Algum caso onde
   a sanitização agora **descarta** um `conditionalLogic` válido que antes mantinha (ou vice-versa)?
F. Algo que o **build de produção** (Vercel) pegaria que o `tsc` local não pegou? Import novo
   `logic-graph.ts → form-logic-engine.ts` cria ciclo ou puxa código client p/ um módulo usado em server?

## Diff da Fase A (código; testes omitidos por brevidade — estão no branch)

```diff
diff --git a/lib/database.types.ts b/lib/database.types.ts
@@ export interface ConditionalRule {
   value?: string
 }
+
+// Conjunção entre múltiplas regras de visibilidade
+export type ConditionalConjunction = 'and' | 'or'
+
+// Grupo de regras de visibilidade (formato novo). O formato legado é uma
+// ConditionalRule única; normalizeConditional() converte os dois para grupo.
+export interface ConditionalGroup {
+  conjunction: ConditionalConjunction
+  rules: ConditionalRule[]
+}
@@ export interface QuestionConfig {
-  conditionalLogic?: ConditionalRule
+  conditionalLogic?: ConditionalRule | ConditionalGroup // legado (objeto) ou novo (grupo)

diff --git a/lib/form-logic-engine.ts b/lib/form-logic-engine.ts
-import { ConditionalRule, QuestionConfig } from '@/lib/database.types'
+import { ConditionalRule, ConditionalGroup, QuestionConfig } from '@/lib/database.types'
@@ (novo) normalizeConditional
+export function normalizeConditional(
+  raw: ConditionalRule | ConditionalGroup | null | undefined,
+): ConditionalGroup {
+  if (!raw) return { conjunction: 'and', rules: [] }
+  if (Array.isArray((raw as ConditionalGroup).rules)) {
+    const group = raw as ConditionalGroup
+    return { conjunction: group.conjunction === 'or' ? 'or' : 'and', rules: group.rules }
+  }
+  return { conjunction: 'and', rules: [raw as ConditionalRule] }
+}
@@ isQuestionVisible (reescrito)
-  const rule = question.conditionalLogic
-  if (!rule || !rule.questionId) return true
-  return evaluateLogicRule(rule, answers)
+  const group = normalizeConditional(question.conditionalLogic)
+  const valid = group.rules.filter((r) => r && r.questionId)
+  if (valid.length === 0) return true
+  return group.conjunction === 'or'
+    ? valid.some((r) => evaluateLogicRule(r, answers))
+    : valid.every((r) => evaluateLogicRule(r, answers))

diff --git a/lib/schemas/form-schema.ts b/lib/schemas/form-schema.ts
+const ConditionalGroupSchema = z
+  .object({
+    conjunction: z.enum(['and', 'or']),
+    rules: z.array(ConditionalRuleSchema).max(20),
+  })
+  .strict()
+const ConditionalLogicSchema = z.union([ConditionalGroupSchema, ConditionalRuleSchema])
@@ QuestionBaseShape
-  conditionalLogic: ConditionalRuleSchema.optional().nullable(),
+  conditionalLogic: ConditionalLogicSchema.optional().nullable(),

diff --git a/lib/logic-graph.ts b/lib/logic-graph.ts
+import { normalizeConditional } from '@/lib/form-logic-engine'
@@ (reescrito) bloco de warnings/label da condição
-    if (q.conditionalLogic) {
-      if (!q.conditionalLogic.questionId) { ...warning... }
-      else if (!byId.has(q.conditionalLogic.questionId)) { ...error... }
-      else { conditionLabel = conditionText(q.conditionalLogic, questions, true) }
-    }
+    const condGroup = normalizeConditional(q.conditionalLogic)
+    if (condGroup.rules.length > 0) {
+      const labels: string[] = []
+      for (const rule of condGroup.rules) {
+        if (!rule.questionId) { ...warning... }
+        else if (!byId.has(rule.questionId)) { ...error... }
+        else { labels.push(conditionText(rule, questions, true)) }
+      }
+      if (labels.length) conditionLabel = labels.join(condGroup.conjunction === 'or' ? ' OU ' : ' E ')
+    }

diff --git a/components/form-builder/form-builder.tsx b/components/form-builder/form-builder.tsx
-import { Form, QuestionConfig, ThemePreset, FormStatus } from '@/lib/database.types'
+import { Form, QuestionConfig, ConditionalGroup, ConditionalRule, ThemePreset, FormStatus } from '@/lib/database.types'
@@ sanitização do save (Fase A: preserva legado)
-      if (next.conditionalLogic && !next.conditionalLogic.questionId) {
-        next = { ...next, conditionalLogic: undefined }
-      }
+      if (next.conditionalLogic) {
+        const cl = next.conditionalLogic
+        if (Array.isArray((cl as ConditionalGroup).rules)) {
+          const rules = (cl as ConditionalGroup).rules.filter(r => r && r.questionId)
+          next = { ...next, conditionalLogic: rules.length ? { ...(cl as ConditionalGroup), rules } : undefined }
+        } else if (!(cl as ConditionalRule).questionId) {
+          next = { ...next, conditionalLogic: undefined }
+        }
+      }

diff --git a/components/form-builder/conditional-visibility-editor.tsx b/components/form-builder/conditional-visibility-editor.tsx
+import { normalizeConditional } from '@/lib/form-logic-engine'
@@ ConditionalVisibilityEditor
-  const rule = question.conditionalLogic
+  // FASE A (read-compat): lê legado OU grupo, mas edita/emite só a regra única legada.
+  const rule = normalizeConditional(question.conditionalLogic).rules[0]
```

> Para auditar com o código vivo: `git checkout feat/condicoes-multiplas-e-ou` e
> `git diff main -- lib/ components/` (inclui os testes). Testes novos:
> `lib/form-logic-engine.test.ts`, `lib/logic-graph.test.ts`, `lib/schemas/form-schema.test.ts`.
