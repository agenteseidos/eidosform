# Briefing para auditoria (Codex) — Gate de CPF/CNPJ no Free + suporte a CNPJ no campo

**Branch:** `fix/fase1-billing-hardening` (working tree, NÃO commitado)
**Data:** 2026-06-15
**Autor da mudança:** Claude (sessão de pricing do Free)
**Tipo:** mudança de produto (pricing/gating) + correção funcional (campo aceita CNPJ)

---

## 1. Objetivo / decisão de negócio

O plano **Free** estava generoso demais (risco de o usuário nunca migrar). Após pesquisa de
mercado (Typeform, Respondi, YayForms, Tally, Fillout, Jotform), decidiu-se **apertar o Free
movendo a validação de CPF/CNPJ para o Starter+** — espelhando o concorrente BR direto
(Respondi), que mantém lógica condicional e CEP no grátis, mas **gateia CPF/CNPJ** no pago.

**Decidido manter no Free:** 100 respostas/mês, 3 formulários, lógica condicional, busca de CEP.
**Decidido mover para Starter+:** validação de CPF/CNPJ (o campo `cpf`).

Durante a implementação descobriu-se que **o campo `cpf` só validava CPF** (11 dígitos) — o
marketing "CPF/CNPJ" era impreciso. Como agora isso vira recurso PAGO e vendido, decidiu-se
**fazer o campo aceitar CNPJ de verdade** antes de cobrar por ele.

São, portanto, **duas mudanças** a auditar:
- **(A)** Gate: tipo de pergunta `cpf` agora exige plano Starter ou superior.
- **(B)** Funcional: o campo `cpf` passa a aceitar e validar CPF **ou** CNPJ.

---

## 2. Mecanismo de gating (contexto pra auditoria)

O gating de tipo de pergunta é centralizado em **`lib/questions.ts` → `QUESTION_TYPE_MIN_PLAN`**
(fonte única de verdade). Padrão já existente para `calendly` (Starter+) e `html_block` (Plus+).
A mudança apenas **adiciona `cpf: 'starter'`** ao mesmo mapa.

Pontos de enforcement que LEEM esse mapa (não foram alterados — herdam o novo gate):
- **Builder** (`components/form-builder/form-builder.tsx`): `addQuestion` bloqueia inserir tipo
  não permitido (toast) e o paletão mostra selo "Starter+".
- **Player público** (`app/f/[slug]/page.tsx:154`): `filterQuestionsByPlan(form.questions, ownerPlan)`
  remove do formulário entregue ao visitante os tipos que o plano do DONO não permite.

---

## 3. Arquivos alterados (12)

### (A) Gate
- **`lib/questions.ts`** — adiciona `cpf: 'starter'` em `QUESTION_TYPE_MIN_PLAN`; atualiza comentário; muda label do tipo de `'CPF'` → `'CPF / CNPJ'`.
- **`lib/plan-definitions.ts`** — move `'Validação CPF/CNPJ'` da lista `features` do Free para a do Starter.
- **`components/pricing-section.tsx`, `billing-plans.tsx`, `v2/pricing-section-v2.tsx`, `v3/pricing-section-v3.tsx`, `v4/pricing-section-v4.tsx`** — move `'Validação de CPF/CNPJ'` de Free → Starter (apenas strings de exibição).
- **`lib/question-gating.test.ts`** — testes: `cpf` exige Starter+; `address` (CEP) segue free; mapa cobre `['calendly','cpf','html_block']`; `filterQuestionsByPlan` perde `cpf` no free.

### (B) CNPJ no campo
- **`lib/validators.ts`** — novo `formatCpfCnpj(value)`: ≤11 dígitos → `formatCPF`, senão `formatCNPJ`. Reusa funções existentes.
- **`lib/field-validators.ts`** — `validateCpfField` agora aceita 11 dígitos (→`validateCPF`) ou 14 (→`validateCNPJ`); demais comprimentos = erro. Importa `validateCNPJ`.
- **`components/form-player/question-renderer.tsx`** — `CpfQuestion`: usa `formatCpfCnpj`; valida CNPJ ao vivo quando 14 dígitos; `maxLength` 14 → 18 (cabe `00.000.000/0000-00`). Import troca `formatCPF` por `formatCpfCnpj` + `validateCNPJ`.
- **`lib/field-validators.test.ts`** — casos de CNPJ válido/inválido e comprimento intermediário (12-13 dígitos) rejeitado.

---

## 4. Invariantes que DEVEM permanecer verdadeiras

1. Tipos não-gateados (`short_text`, `email`, `address`/CEP, etc.) continuam disponíveis em qualquer plano.
2. `calendly` (Starter+) e `html_block` (Plus+) mantêm seus gates inalterados.
3. CEP (`address`) e lógica condicional **continuam no Free** (não foram movidos).
4. Backend (`validateCpfField`) e frontend (`CpfQuestion`) concordam na validação (CPF 11 / CNPJ 14 / resto inválido).
5. Nenhum plano pago perde CPF/CNPJ — só o Free.
6. A vitrine (todos os cards de preço) reflete o gate: CPF/CNPJ aparece no Starter, não no Free.

---

## 5. Riscos e perguntas adversariais para o Codex

### Sobre o gate (A)
- **A1.** A submissão de resposta (`app/api/responses/route.ts`) revalida/aceita um campo `cpf`
  mesmo quando o dono é Free? Como o player remove o campo via `filterQuestionsByPlan`, o
  visitante não envia esse valor — mas confirmar que **um POST direto** com resposta a um campo
  `cpf` num form de dono Free não cria inconsistência (e que isso é aceitável/igual ao Calendly).
- **A2.** **Lógica condicional órfã:** se um form de dono Free tem um campo `cpf` que é **alvo de
  um jump** ou **referência de visibilidade condicional**, e o campo é removido pelo filtro, o
  fluxo quebra? (O comentário em `filterQuestionsByPlan` afirma que o motor ignora jumps com
  alvo ausente — `form-logic-engine.getNextQuestionId`. Verificar que isso cobre TAMBÉM
  `isQuestionVisible`/condições que referenciam o campo removido.)
- **A3.** **Downgrade:** usuário Starter→Free com campo CPF/CNPJ em form publicado — o campo some
  do player (perda de coleta para novas respostas). É o comportamento desejado, mas confirmar que
  não gera erro de runtime nem some o formulário inteiro.
- **A4.** Existe algum **template/seed/onboarding** que insere um campo `cpf` por padrão (que agora
  ficaria bloqueado/filtrado no Free)? Buscar.
- **A5.** Existe algum **flag booleano de plano** (ex.: `cpfCnpj: boolean` em `PlanConfig`) usado em
  outro ponto que precise ser sincronizado? (Acredita-se que NÃO — o gate é só via
  `QUESTION_TYPE_MIN_PLAN` — confirmar que não há matriz/tabela comparativa paralela fora dos
  `features[]` já ajustados.)
- **A6.** Sobrou alguma superfície de marketing com "CPF/CNPJ" listado como recurso do Free?
  (grep amplo, incluir páginas alternativas tipo `app/pgb/page.tsx`, READMEs, landing, e-mails.)

### Sobre o CNPJ no campo (B)
- **B1.** **Duplicação de validador:** agora há `validateCNPJ` em `lib/validators.ts` (usado aqui)
  e `isValidCpfOrCnpj`/`isValidCnpj` em `lib/cpf-cnpj.ts` (usado no billing). Confirmar que as
  duas implementações são **equivalentes** (mesmos casos de borda: todos dígitos iguais, DV).
  Pré-existente — não introduzido aqui — mas vale sinalizar se divergirem.
- **B2.** **Paridade front/back:** `CpfQuestion` (front) usa `validateCPF`/`validateCNPJ` de
  `validators.ts`; `validateCpfField` (back) idem. Garantir que NÃO há caminho onde o front
  aceita e o back rejeita (ou vice-versa), p.ex. espaços, máscara, comprimento 12-13.
- **B3.** **Valor armazenado:** a resposta é salva **formatada** (`11.222.333/0001-81`). Algum
  consumidor downstream (export CSV, webhook, integrações, exibição em `responses`) assume formato
  de CPF (`000.000.000-00`) ou 11 dígitos e quebraria com CNPJ?
- **B4.** **`maxLength={18}`:** confere com a máscara de CNPJ (`00.000.000/0000-00` = 18 chars) e
  não corta CPF (`000.000.000-00` = 14). OK?
- **B5.** **Zona morta de digitação (12-13 dígitos):** `formatCpfCnpj` aplica máscara de CNPJ a
  partir de 12 dígitos, mas a validação só passa em 14. Confirmar que isso é só estado transitório
  de digitação (aceitável) e não trava o submit indevidamente.
- **B6.** Campo `cpf` **obrigatório vs opcional:** a mudança de mensagens de erro
  ("CPF deve ser texto" → "CPF/CNPJ deve ser texto") afeta algum teste/asserção em outro lugar?

---

## 6. Estado dos testes

- `lib/question-gating.test.ts` + `lib/field-validators.test.ts`: **35/35 passando** (vitest).
- **NÃO** foi rodado `npm run build` completo (memória do projeto registra risco de OOM na fase
  TypeScript; recomendado rodar com `NODE_OPTIONS=--max-old-space-size=3072` antes do deploy).
- **NÃO** commitado, **NÃO** deployado. Sem migrations (mudança não toca schema).

---

## 7. Consequência de comportamento a confirmar com o negócio

Após subir, **formulários de usuários Free que já usam o campo CPF deixam de exibi-lo** ao
publicar (filtrado pelo plano do dono). É a pressão de migração desejada, mas é uma mudança em
forms EXISTENTES, não só nos novos. Mesmo mecanismo já aplicado ao Calendly pós-downgrade.

---

## 8. Diff de referência (núcleo)

> Os arquivos de exibição (5 cards de preço) são apenas movimentação da string
> `'Validação de CPF/CNPJ'` de Free → Starter. O núcleo funcional está abaixo.

Ver `git diff` em: `lib/questions.ts`, `lib/field-validators.ts`, `lib/validators.ts`,
`components/form-player/question-renderer.tsx`, `lib/plan-definitions.ts`.

---

## 9. Atualização pós 1ª auditoria Codex (2026-06-15)

A 1ª passada do Codex encontrou e corrigiu o seguinte (já no working tree):

### P1 — Gate não era aplicado em POST direto (CORRIGIDO)
A pergunta A1 deste briefing se confirmou como bug. O gate só rodava no builder e no
player (`filterQuestionsByPlan`), mas os endpoints de submissão validavam/persistiam com
`form.questions` completo. Um POST direto podia gravar resposta em campo `cpf` de dono Free.

**Correção (Codex):** os 3 endpoints agora buscam o plano efetivo do dono
(`getEffectivePlan`) e derivam `effectiveQuestions = filterQuestionsByPlan(...)`, usado de
forma consistente em `pruneOrphanAnswers`, `validateAllAnswers`, `isResponseComplete` e em
todos os efeitos (Sheets, WhatsApp, CAPI, webhook):
- `app/api/responses/route.ts`
- `app/api/responses/partial/route.ts`
- `app/api/v1/forms/[id]/route.ts`
+ teste novo em `app/api/responses/partial/route.test.ts`.

### Residual — resposta vazia após prune consumia cota (CORRIGIDO nesta sessão)
Observação do Codex: se todas as chaves enviadas fossem podadas (órfãs ou bloqueadas), o
`/api/responses` e o `/api/v1/forms/[id]` ainda chamavam `checkAndIncrementResponseCount`
e inseriam uma resposta vazia — **queimando um slot da cota mensal** via POST direto.
(O `/api/responses/partial` já tinha a guarda `pruned vazio → skipped`.)

**Correção:** guarda nos dois endpoints — se `answers` fica vazio após o prune **E** houve
chaves removidas (`removedKeys.length > 0`), retorna **422 "Nenhuma resposta válida para
salvar"** ANTES de consumir cota. O caso legítimo de form todo-opcional submetido vazio
(sem chaves removidas) **não** é afetado. Teste novo em `app/api/responses/route.test.ts`
prova: 422, sem insert, e `checkAndIncrementResponseCount` **não** é chamado.

### Estado final desta sessão
- **Testes:** `npx vitest run` nos 4 arquivos (responses, partial, gating, field-validators) → **60/60 passando**.
- **Typecheck:** `npx tsc --noEmit` → **0 erros**.
- **Build completo:** segue NÃO rodado aqui (risco de OOM; o Codex registrou exit 137/Killed ao tentar). Rodar na infra antes do deploy.
- **Pendente de re-auditoria:** confirmar a guarda residual e os pontos B1–B3 e A2 (lógica condicional órfã referenciando campo removido em `isQuestionVisible`).
