# Plano de Execução — Fechamento da Auditoria de Correções (EidosForm)

> **Para:** Zé / OpenClaw / Claude Code
> **De:** Sidney (via Claude Code Opus 4.7)
> **Data:** 2026-05-04
> **Origem:** Auditoria da execução de [plano-execucao-correcoes-auditoria.md](plano-execucao-correcoes-auditoria.md). 13 de 19 etapas concluídas integralmente; este plano endereça as **lacunas reais** identificadas.

---

## Como trabalhar

1. **Uma etapa por vez.** Não pular, não misturar.
2. **Ao concluir cada etapa:** acrescentar entrada em [relatorio-correcoes-auditoria.md](relatorio-correcoes-auditoria.md) no formato:
   ```markdown
   ## Etapa N — <título> (Fechamento)
   **Status:** ✅ Concluída em YYYY-MM-DD HH:MM
   **Commits:** <hash1>, <hash2>
   **Achados endereçados:** <ids>
   **Arquivos alterados:** <lista>
   **O que foi feito:** <resumo objetivo>
   **Validação:** <como validou>
   **Pendências dentro da etapa:** <lista ou "nenhuma">
   ```
3. **Commits em conventional commits, em inglês.**
4. **Branch única para todo o fechamento:** `fix/auditoria-fechamento`. PR ao final.
5. **Achados extras descobertos:** anotar em [achados-extras.md](achados-extras.md) e seguir.

---

## BLOCO H — Hardening da VPS WhatsApp (resíduos da Etapa 10)

> **Prazo:** hoje. São 2 itens deixados de fora na execução anterior.

### Etapa H1 — Hash SHA-256 de PII em logs WhatsApp

**Achado:** F2-E1-08 / item 4 da Etapa 10 — `phone` ainda é logado em texto puro em [services/whatsapp/server.js](services/whatsapp/server.js) (linhas 229, 241, 265-266) e em [lib/integration-stubs.ts](lib/integration-stubs.ts).

**Passos:**
1. Em `services/whatsapp/server.js`, criar helper:
   ```js
   const crypto = require('crypto')
   const hashPhone = (p) => p ? crypto.createHash('sha256').update(String(p)).digest('hex').slice(0, 8) : 'null'
   ```
2. Substituir todos os `console.log/error` que contenham `phone` ou `cleaned` (telefone limpo) por logs com `hashPhone(phone)`. Mensagens de erro de wacli também devem usar hash. Exceção: o argumento `phone` passado para `wacli send --to` continua em texto (necessário para o envio).
3. Em [lib/integration-stubs.ts](lib/integration-stubs.ts), aplicar mesmo padrão (hashPhone derivado de `crypto` da Node std lib).
4. Validar: `grep -n "phone" services/whatsapp/server.js | grep -i "console\|log"` — nenhuma linha de log deve conter `phone`/`cleaned` cru.

**Critério de done:** logs de produção (após reload) não mostram telefones em texto.

---

### Etapa H2 — Headers de segurança no nginx

**Achado:** F2-E1-06 / item 6 da Etapa 10 — [services/whatsapp/nginx-updated.conf](services/whatsapp/nginx-updated.conf) sem `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`.

**Passos:**
1. Em `services/whatsapp/nginx-updated.conf`, dentro do bloco `server { ... }` SSL, adicionar:
   ```nginx
   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header Referrer-Policy "same-origin" always;
   ```
2. Copiar para a VPS (`scp` ou edição direta) e rodar `nginx -t && systemctl reload nginx`.
3. Validar: `curl -sI https://wa.eidosform.com.br | grep -E 'Strict-Transport|X-Content-Type|Referrer-Policy'` — 3 headers presentes.

**Critério de done:** os 3 headers presentes em resposta HEAD.

---

## BLOCO I — DNS / Email Hygiene (resíduos da Etapa 2)

> **Prazo:** hoje (alterações DNS levam ~1h propagação).

### Etapa I1 — Null MX no apex (RFC 7505)

**Achado:** F2-E1-02 — MX atual `0 eidosform.com.br.` rebota em loop. Trocar para null MX explícito.

**Passos:**
1. Painel DNS de `eidosform.com.br`: trocar registro MX existente por `0 .` (RFC 7505 — "este domínio não recebe email").
2. Aguardar propagação. Validar:
   ```bash
   dig +short MX eidosform.com.br
   ```
   Esperado: `0 .`
3. Confirmar no painel Resend que sender continua em `send.eidosform.com.br` (não exige MX no apex).

**Critério de done:** `dig MX` retorna `0 .`; emails Resend continuam saindo (smoke test).

---

### Etapa I2 — DMARC `rua` para inbox dedicada

**Achado:** F2-E1-03 — DMARC `rua=mailto:agenteseidos@gmail.com` aponta para Gmail pessoal. Plano original recomendava inbox dedicada.

**Passos:**
1. Criar (ou reutilizar) endereço dedicado para relatórios DMARC, ex: `dmarc-reports@institutoeidos.com.br` (caixa institucional, não pessoal).
2. Atualizar registro TXT em `_dmarc.eidosform.com.br` para:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc-reports@institutoeidos.com.br
   ```
3. Aguardar propagação. Validar:
   ```bash
   dig +short TXT _dmarc.eidosform.com.br
   ```
4. Adicionar lembrete em `MEMORY.md` (memória do agente): em ~14 dias, evoluir DMARC para `p=quarantine` se relatórios não acusarem falsos positivos.

**Critério de done:** TXT `_dmarc` aponta para inbox não-pessoal.

---

## BLOCO J — Higiene de Artefatos e Backlog (resíduos das Etapas 16, 18 e Achados Extras)

> **Prazo:** hoje + 1 dia.

### Etapa J1 — Notificação de DLQ por email ao owner

**Achado:** Pendência declarada da Etapa 16 — `webhook_failures` registra mas não notifica.

**Passos:**
1. Em [lib/webhook-dispatcher.ts](lib/webhook-dispatcher.ts), na função `insertDlq`: após o insert bem-sucedido, contar quantas falhas o `formId` tem nos últimos 7 dias (`select count from webhook_failures where form_id=? and created_at > now() - interval '7 days'`).
2. Se `count >= 3` (3 falhas em 7 dias), enviar email ao `ownerEmail` via `sendEmailWithRetry` com subject `[EidosForm] Webhook do formulário "{title}" falhando` e corpo com últimos 3 erros + link para `/forms/{id}/integrations`.
3. Para evitar spam: gravar `last_owner_notification_at` em `forms` (migration nova) e re-notificar no máx. 1x/24h.
4. Validar: simular 3 falhas seguidas em ambiente de staging → email chega.

**Critério de done:** após 3 falhas em 7 dias, owner recebe 1 email/24h.

---

### Etapa J2 — Deletar artefatos de teste em produção

**Achado:** Item 6 da Etapa 18 — form de teste, contas de teste e pasta `/tmp/eidos-audit/` continuam em produção.

**Passos:**
1. Em Supabase Studio, deletar:
   - Form `af8ea379-cea0-4471-b1ee-d63e2daffc19` (`[TESTE-AUDITORIA-2026-05-02]`).
   - Contas (auth.users + profiles) `eb2d9c6d-6119-47a2-9c5f-f9bbe95a89ec` e `a4066c51-3c0c-43f3-85f0-7298d2091482`.
   - Verificar antes que não são contas reais (consultar `email`, `created_at`, `last_sign_in_at`).
2. Na VPS: `rm -rf /tmp/eidos-audit/` (após confirmar que não há nada útil ali).
3. Validar: query `select id, title from forms where title ilike '%TESTE-AUDITORIA%'` retorna 0 linhas.

**Critério de done:** artefatos deletados, queries de verificação retornam vazio.

---

### Etapa J3 — Atualizar `achados-extras.md` (BUG-EXTRA-1)

**Achado:** [achados-extras.md](achados-extras.md) registra BUG-EXTRA-1 (upload imagem 413) como ⚠️ Pendente, mas commits `5d26ff3` (signed URL) e correlatos sugerem resolução.

**Passos:**
1. Validar funcionalmente: criar form com `file_upload`, submeter resposta com imagem >1MB via player público em produção. Verificar que a imagem é aceita e a URL salva é do bucket Supabase Storage.
2. Se OK, atualizar `achados-extras.md`: trocar status para `✅ Resolvido em <data>` com referência aos commits `5d26ff3`, `2ee2ead`.
3. Se ainda quebrado, abrir uma Etapa nova neste plano.

**Critério de done:** status correto refletido no arquivo.

---

## BLOCO K — Encerramento Formal da Auditoria (Etapa 19 verdadeira)

> **Prazo:** após blocos H, I, J. Este é o "fim de obra".

### Etapa K1 — Smoke test ponta-a-ponta executado

**Achado:** [regression-checklist.md](regression-checklist.md) tem todas as caixas `[ ]` vazias.

**Passos:**
1. Abrir [regression-checklist.md](regression-checklist.md) e percorrer **todas as seções**: smoke test ponta-a-ponta, 18 tipos de pergunta, dashboard, billing, settings, custom domain.
2. Para cada item: testar manualmente em produção, marcar `[x]` quando passa, `[ ]` + nota explicando se falha.
3. Cada falha vira achado novo neste plano (Etapa K-N).
4. Commitar o checklist atualizado.

**Critério de done:** 100% das linhas com `[x]` ou explicação de falha registrada.

---

### Etapa K2 — Marcar achados nas auditorias originais

**Achado:** [auditoria-uso-fase1.md](auditoria-uso-fase1.md) e [auditoria-uso-fase2.md](auditoria-uso-fase2.md) sem nenhuma marcação `✅/⚠️/❌` (grep retornou 0 ocorrências).

**Passos:**
1. Para cada achado em `auditoria-uso-fase1.md` (107) e `auditoria-uso-fase2.md` (20): adicionar prefixo na linha de status:
   - `✅ resolvido — Etapa <N> commit <hash>`
   - `⚠️ pendente — <razão e próximo passo>`
   - `❌ recusado — <justificativa>`
2. Cruzar com [relatorio-correcoes-auditoria.md](relatorio-correcoes-auditoria.md) para mapear achado → etapa → commit.
3. Achados que não foram tocados em nenhuma etapa: classificar como ⚠️ pendente OU ❌ recusado com justificativa.

**Critério de done:** todo achado das duas fases tem marcação explícita; `grep -c "✅ resolvido\|⚠️ pendente\|❌ recusado"` retorna ≈127 (total).

---

### Etapa K3 — Completar `relatorio-correcoes-auditoria.md`

**Achado:** Relatório oficial cobre só 10 das 19 etapas originais + faltam todas as etapas deste novo plano (H1-K3).

**Passos:**
1. Adicionar entradas formais (no template) para as etapas originais ausentes: **1, 2, 3, 10, 11, 18, 19**. Usar commits existentes do git log; status `✅` ou `⚠️ parcial` conforme realidade.
2. Adicionar entradas para etapas H1, H2, I1, I2, J1, J2, J3, K1, K2 deste plano.
3. Acrescentar **Sumário Executivo** no topo com:
   - Total de achados (Fase 1: 107, Fase 2: 20, Extras: N).
   - Resolvidos / pendentes / recusados.
   - Lista de blocos completos (A-G + H-K).
   - Riscos remanescentes.
   - Próxima auditoria sugerida (Fase 3 ponta-a-ponta com conta de teste secundária — conforme já planejado).

**Critério de done:** relatório cobre 100% das etapas executadas e tem sumário executivo no topo.

---

## Resumo dos blocos novos

| Bloco | Etapas | Prazo | Foco |
|---|---|---|---|
| **H — VPS WhatsApp** | H1, H2 | hoje | PII hash + headers nginx |
| **I — DNS/Email** | I1, I2 | hoje (propagação 1h) | Null MX + DMARC dedicado |
| **J — Backlog** | J1, J2, J3 | hoje + 1 dia | DLQ email, deletar artefatos, achados-extras |
| **K — Encerramento** | K1, K2, K3 | após H/I/J | Smoke test, marcação de achados, relatório completo |

**Total:** 9 etapas novas. Blocos H, I e J podem rodar em paralelo (sem overlap de arquivos). Bloco K é serial e bloqueia o "Done Final".

---

**FIM do plano.** Confirmar com Sidney antes de iniciar Bloco H.
