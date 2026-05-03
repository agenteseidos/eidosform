# Auditoria QA — Correções de Auditoria EidosForm

Data: 2026-05-03
Repo auditado: `/home/sidney/eidosform`
Base comparada: `772d38f..HEAD`

## Escopo auditado
- Plano: `plano-execucao-correcoes-auditoria.md`
- Relatório de execução: `relatorio-correcoes-auditoria.md`
- Commits auditados:
  - `86c7e10` — Bloco A
  - `66fc225`, `ead7d8a` — Bloco B
  - `e9f6c4d`, `23676e5`, `64c51b7` — Bloco C
  - `633a844`, `cbc40e3`, `a2113e4` — Bloco E
  - `5bd97f2`, `b435fcd`, `09b871c` — Bloco F
  - `3ee83f7` — Bloco G

## Veredito executivo
**Resultado geral: ❌ Reprovado para fechamento de QA sem pendências.**

Motivos principais:
1. `tsc --noEmit` **falha** no estado atual do repositório.
2. Há achados P1/P2 introduzidos ou deixados pelo pacote de correções, especialmente em **Bloco E**.
3. Há vários pontos aceitáveis para merge incremental, mas não para considerar a auditoria inteira “limpa”.

## Validação TypeScript
Rodado ao final:

```bash
npx tsc --noEmit
```

Resultado:

```text
app/api/forms/route.ts(156,5): error TS2322: Type '{ [x: string]: unknown; metaPixelId?: string | null | undefined; googleAdsId?: string | null | undefined; googleAdsLabel?: string | null | undefined; tiktokPixelId?: string | null | undefined; gtmId?: string | ... 1 more ... | undefined; } | null' is not assignable to type 'PixelConfig | null | undefined'.
  Type '{ [x: string]: unknown; metaPixelId?: string | null | undefined; googleAdsId?: string | null | undefined; googleAdsLabel?: string | null | undefined; tiktokPixelId?: string | null | undefined; gtmId?: string | ... 1 more ... | undefined; }' is not assignable to type 'PixelConfig'.
    Types of property 'metaPixelId' are incompatible.
      Type 'string | null | undefined' is not assignable to type 'string | undefined'.
        Type 'null' is not assignable to type 'string | undefined'.
```

Contagem de erros TS:
- **1 erro**

---

# Bloco A — Fix `/api/responses` 500
Commits: `86c7e10`

## Veredito
**✅ Aprovado**

## O que foi validado
- Corrige a causa raiz do 500 em `/api/responses`: uso destacado de `supabase.rpc` perdia o binding de `this`.
- Chamadas passaram a usar `supabase.rpc(...)` diretamente.
- Remoção de endpoints debug foi positiva para segurança.

## Bugs encontrados
- **P2:** `checkAndIncrementResponseCount` permanece em modo **fail-open** quando RPC falha, permitindo bypass de limite de plano se o RPC quebrar. Tradeoff consciente para não bloquear submissões, mas é risco operacional.
- **P3:** uso de type assertions redundantes em retorno de `supabase.rpc()`.

## Regressões introduzidas
- Nenhuma regressão funcional identificada.

## Recomendações
- Monitorar falhas do RPC de quota, porque hoje elas liberam submissão.
- Limpar assertions desnecessárias e alinhar typing com `database.types.ts`.

---

# Bloco B — Auth: signup, login, CSRF
Commits: `66fc225`, `ead7d8a`

## Veredito
**✅ Aprovado**

## O que foi validado
- Signup deixa de vazar diferença entre email novo e já existente.
- Login bloqueia email não confirmado e reduz payload de sucesso.
- Bypass CSRF de `/api/auth/*` foi removido, sobrando apenas `/api/responses`.

## Bugs encontrados
- Nenhum bug P0-P3 relevante encontrado no bloco.

## Regressões introduzidas
- Nenhuma regressão identificada.

## Recomendações
- Manter teste automatizado de paridade de resposta no signup para evitar reintrodução de enumeração.
- Adicionar teste de CSRF por Origin malicioso nos endpoints auth.

---

# Bloco C — Zod, validators, DOMPurify
Commits: `e9f6c4d`, `23676e5`, `64c51b7`

## Veredito
**✅ Aprovado**

## O que foi validado
- Schemas Zod cobrem os 18 tipos e estão aplicados em POST/PATCH.
- `isSafeUrl` bloqueia esquemas perigosos relevantes.
- Validators server-side foram endurecidos nos casos previstos.
- Sanitização server-side com DOMPurify + jsdom foi implementada.

## Bugs encontrados
- **P2:** duplicação de `isSafeUrl` em mais de um módulo, criando risco de drift entre regras.
- **P2:** hardening pós-sanitize de `href` usa regex só para atributos com aspas duplas; como defense-in-depth, isso é incompleto.
- **P3:** unidade de `file_upload.maxFileSize` não está claramente documentada no schema.
- **P3:** `validateFileUpload` ainda aceita `https://` de forma ampla, em vez de restringir melhor a storage URL esperada.

## Regressões introduzidas
- Nenhuma regressão funcional clara identificada.

## Recomendações
- Extrair `isSafeUrl` para uma única fonte de verdade.
- Trocar scrub de `href` por abordagem baseada em DOM, não regex.
- Apertar a validação de URL de file upload.

---

# Bloco E — Dashboard, player UX, API fixes
Commits: `633a844`, `cbc40e3`, `a2113e4`

## Veredito
**❌ Reprovado**

## O que foi validado
- `PlanQuotaCard` existe e exibe quota/upsell.
- Player corrige contador sem `content_block`, hint de `Ctrl+Enter`, e scroll em erro.
- GET de API key deixa de retornar 404 em perfil ausente.
- `GET /api/forms/{id}` deixou de quebrar por coluna inexistente com troca para `select('*')`.

## Bugs encontrados
- **P1:** em `GET /api/forms/{id}`, o `!data` após `.single()` é código morto e mascara o entendimento correto do fluxo de erro do Supabase. Não quebra sozinho, mas indica correção incompleta do caminho de erro.
- **P2:** `select('*')` em `forms` é regressão de higiene de segurança e de contrato de API. Se a tabela ganhar coluna sensível no futuro, ela será exposta automaticamente.
- **P2:** `PlanQuotaCard` não usa o endpoint previsto no plano (`/api/user/plan-features`), consulta direto `profiles` no server component.
- **P2:** fallback silencioso do card pode mascarar erro de leitura do perfil e exibir dados default incorretos.
- **P3:** scroll em erro pode disparar mais vezes que o necessário por dependência frágil de render.

## Regressões introduzidas
- Regressão potencial de exposição futura por `select('*')`.
- Desvio de implementação em relação ao plano na origem dos dados do quota card.

## Recomendações
- Voltar para seleção explícita de colunas em `GET /api/forms/{id}` e remover apenas a coluna fantasma.
- Tratar erro do quota card explicitamente.
- Alinhar implementação do card ao endpoint definido no plano ou justificar desvio.

---

# Bloco F — Webhooks Asaas, outgoing webhooks, notifications
Commits: `5bd97f2`, `b435fcd`, `09b871c`

## Veredito
**✅ Aprovado com ressalvas**

## O que foi validado
- Entrada Asaas com parser melhor, HMAC-only e idempotência.
- Webhooks de saída com secret obrigatório, JSON canônico, bloqueio melhor de SSRF e DLQ.
- Notificações com sanitização de subject, retry Resend, Unicode normalize e rate-limit por form+phone.
- Migrations SQL auditadas como válidas.

## Bugs encontrados
- **P2:** `checkAndMarkIdempotent` segue fail-open em certos erros não-`23505`.
- **P2:** loop de retry em outgoing webhook ficou inconsistente com o desenho anterior e com o comentário, reduzindo tentativas efetivas.
- **P2:** nem todos os emails relevantes usam `Idempotency-Key`; duplicidade ainda pode ocorrer em alguns fluxos.
- **P2:** truncamento de assunto sanitizado pode deixar fragmento parcial em caso extremo.
- **P3:** criação de client Supabase por dispatch em outgoing webhook.
- **P3:** normalização NFKC do template inteiro de WhatsApp pode alterar Unicode intencional do usuário.

## Regressões introduzidas
- Redução silenciosa no número efetivo de retries do dispatcher de webhook.

## Recomendações
- Corrigir laço de retry para casar com a política pretendida.
- Expandir `Idempotency-Key` para outros envios de email.
- Revisar os poucos pontos fail-open restantes em integração financeira.

---

# Bloco G — P3 cleanup
Commits: `3ee83f7`

## Veredito
**✅ Aprovado**

## O que foi validado
- Melhorias de acessibilidade foram aplicadas.
- Strings foram convertidas para pt-BR nos pontos auditados.
- Logger ganhou redaction de PII.
- Paginação ganhou tiebreaker estável.
- `JSON.parse` passou a ter logging de falha no UTM tracker.

## Bugs encontrados
- **P3:** regex de telefone do redactor pode gerar falsos positivos em IDs/strings numéricas.
- **P3:** `aria-label` duplicado em alguns controles.

## Regressões introduzidas
- Nenhuma regressão relevante identificada.

## Recomendações
- Refinar regex de redaction para reduzir falsos positivos.
- Melhorar unicidade/clareza de labels acessíveis duplicados.

---

# Resumo por bloco

| Bloco | Status | P0 | P1 | P2 | P3 |
|---|---|---:|---:|---:|---:|
| A | ✅ Aprovado | 0 | 0 | 1 | 1 |
| B | ✅ Aprovado | 0 | 0 | 0 | 0 |
| C | ✅ Aprovado | 0 | 0 | 2 | 2 |
| E | ❌ Reprovado | 0 | 1 | 4 | 1 |
| F | ✅ Aprovado com ressalvas | 0 | 0 | 4 | 2 |
| G | ✅ Aprovado | 0 | 0 | 0 | 2 |

---

# Conclusão final

## Aprovado / reprovado por bloco
- **Bloco A:** ✅ Aprovado
- **Bloco B:** ✅ Aprovado
- **Bloco C:** ✅ Aprovado
- **Bloco E:** ❌ Reprovado
- **Bloco F:** ✅ Aprovado com ressalvas
- **Bloco G:** ✅ Aprovado

## Bloqueadores para fechar a auditoria como concluída
1. **`tsc --noEmit` falhando** no estado atual.
2. **Bloco E reprovado**, principalmente por `select('*')` em `GET /api/forms/{id}` e pelo desvio/fragilidade na implementação do quota card.

## Recomendação de QA
- **Não considerar a rodada inteira encerrada ainda.**
- Prioridade imediata:
  1. corrigir o erro TypeScript em `app/api/forms/route.ts`
  2. ajustar `GET /api/forms/{id}` para voltar a seleção explícita e segura
  3. revisar os P2 destacados em Blocos E e F
- Após isso, reexecutar:
  - `npx tsc --noEmit`
  - smoke targeted nos endpoints `/api/forms`, `/api/forms/{id}`, notificações e webhooks
