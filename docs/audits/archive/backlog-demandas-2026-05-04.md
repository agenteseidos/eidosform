# Backlog — Demandas Admin Panel + Auditoria WhatsApp

> **Origem:** sessão de Sidney + Claude Code em 2026-05-04 (após fechamento do plano de auditoria).
> **Status:** 📋 backlog — não iniciado. Aguardando priorização e início de execução.
> **Próximo passo:** consolidar em planos de execução individuais (um por demanda) ou agrupar.

---

## Demanda 1 — Ajuste de tempo de acesso ao plano (Admin)

**Tela:** [eidosform.com.br/admin/users](https://eidosform.com.br/admin/users) → botão "Alterar plano"

**Estado atual:**
- O modal/ação "Alterar plano" só permite trocar o nível (Free / Plus / Professional).

**O que falta:**
- Editar **tempo de acesso ao plano** (data de expiração ou dias restantes).
- UI sugerida: **calendário de dias** dentro do mesmo modal de "Alterar plano".

**Comportamento esperado:**
- Admin define a data até quando o plano vale.
- Alteração persiste no **Supabase** (provavelmente coluna `profiles.plan_expires_at` ou similar — confirmar schema).
- Após a data, o sistema reverte automaticamente para `free` (igual ao fluxo de plano expirado já existente).

**Dependências técnicas a investigar:**
- Schema atual da tabela `profiles` — qual coluna armazena a expiração?
- Endpoint admin existente `/api/admin/users/[id]/plan` — só atualiza o nível ou já tem suporte a data?
- Lógica de "plano expirado" (`/api/user/plan-features` provavelmente) — se já reverte para `free` quando data passa, basta atualizar UI.

**Severidade:** P1 — funcional para gestão de assinaturas (sem isso, admin não consegue dar trial / extensão).

---

## Demanda 2 — Botão de acesso rápido ao Admin Panel

**Onde:** painel principal do EidosForm (provavelmente nav superior ou menu do usuário).

**Quando aparecer:**
- Apenas quando o usuário logado for admin (ex.: `medeiros.sco@gmail.com`).
- Pode usar a flag/role já existente (`is_admin` em `profiles`?) — confirmar.

**Comportamento:**
- Botão/link com ícone (ex: escudo) e label "Admin".
- Atalho para `/admin`.
- Sumir/esconder para usuários não-admin.

**Severidade:** P3 — quality of life. Não bloqueia nada (admin acessa via URL hoje).

---

## Demanda 3 — Cards de Métricas clicáveis + drill-down + impersonate ("view as user")

**Tela:** [eidosform.com.br/admin](https://eidosform.com.br/admin) (dashboard "Métricas gerais")

**Cards afetados (todos os 3):**
- "Total de usuários"
- "Total de forms"
- "Total de respostas"

**Comportamento esperado:**
- Cards viram clicáveis → abrem listagem detalhada da entidade.
- "Total de usuários" → lista de usuários (já existe em `/admin/users`, talvez ampliar).
- "Total de forms" → lista de **todos os forms da plataforma** (filtrável por dono).
- "Total de respostas" → lista de respostas (com link para o form e a resposta).
- A partir das listas, conseguir abrir o painel do usuário no modelo **"view as user" / impersonate** (clássico SaaS):
  - Ver os forms que ele criou (read-only de painel).
  - Ver as respostas que ele recebeu.
  - Foco em **visualização** — sem edições acidentais.
  - Botão "Sair do modo impersonate" sempre visível.

**Dependências técnicas a investigar:**
- Implementação de impersonate típica:
  - Endpoint admin `/api/admin/impersonate/[user_id]` que gera cookie/token de sessão substituindo `auth.uid()`.
  - Banner global "Você está visualizando como X — [Sair]".
  - RLS continua respeitando o `auth.uid()` "fake" — admin vê só o que aquele user veria.
- Alternativa mais simples: páginas admin separadas (`/admin/users/[id]/forms`, `/admin/users/[id]/responses`) que usam `service_role` server-side mas renderizam UI similar ao do dono.

**Severidade:** P2 — gestão e suporte (sem isso, debug de problemas de cliente fica capenga).

---

## Demanda 4 — Auditoria completa do serviço WhatsApp

**Contexto:** o serviço WhatsApp era um repositório separado em `/home/sidney/eidosform-whatsapp/` e foi migrado para dentro do monorepo em `/home/sidney/eidosform/services/whatsapp/`. Sintomas observados durante o fechamento do plano de auditoria (Bloco H):
- Dois daemons PM2 rodando em paralelo (resolvido durante deploy desta sessão).
- Caminho de log em código novo apontando pra path antigo (`LOG_FILE = '/home/sidney/eidosform-whatsapp/server.log'`).
- Card "Últimos envios" no admin mostrando `unknown` / `Formulário sem título` (suspeita: lookup de form via `phone_number` está furado, ou logs antigos com `form_id` faltando).

**Escopo da auditoria:**
- **Código** (`services/whatsapp/server.js`, `lib/integration-stubs.ts`, `app/api/whatsapp/*`, `lib/whatsapp-*`):
  coerência entre paths, paths hard-coded, error handling, segurança, vazamento de PII.
- **Organização das pastas:** confirmar que tudo está em `services/whatsapp/`; identificar resíduos em `/home/sidney/eidosform-whatsapp/` ainda referenciados; sugerir limpeza.
- **Apontamentos:** ecosystem PM2, nginx, env vars, paths em código JS, paths em código TS — tudo coerente com a nova localização.
- **Admin Panel WhatsApp** (tela do print): "Últimos envios" mostrando `unknown` é suspeito; investigar.
- **Schema/dados:** tabela `form_whatsapp_logs` — populada corretamente? `phone_number` em texto puro vs hash? lookup de form correto?

**Resposta esperada:**
- Relatório no padrão `auditoria-uso-fase1.md` / `fase2.md` com achados P0/P1/P2/P3.
- Plano de correção subsequente (`plano-execucao-correcao-whatsapp.md`).

**Plano de execução proposto:**

### BLOCO L — Auditoria estática (read-only) — ~45 min
- **L1** — Inventário de paths (`grep`/`find` em todo o repo, PM2 dump, nginx, env, systemd, cron, package.json).
- **L2** — Auditoria do código `services/whatsapp/server.js` (paths hardcoded, erro, segurança, PII, deps, endpoints).
- **L3** — Auditoria das integrações TS (`lib/integration-stubs.ts`, `app/api/whatsapp/*`, `app/admin/whatsapp/*`, schema `form_whatsapp_logs`).
- **L4** — Auditoria operacional (resíduos VPS em `/home/sidney/eidosform-whatsapp/`, PM2 dump, nginx upstream, DNS `wpp.eidosform.com.br`, permissões).
- **L5** — Consolidar relatório `auditoria-whatsapp-2026-05-04.md`.

### BLOCO M — Plano de correção — ~15 min
- **M1** — Gerar `plano-execucao-correcao-whatsapp.md` no padrão dos planos anteriores.

**Severidade:** P1 — risco operacional alto (loop PM2 já aconteceu uma vez nesta sessão; provável repetir).

---

## Resumo / Priorização sugerida

| # | Demanda | Severidade | Esforço estimado | Bloqueia? |
|---|---|---|---|---|
| **4** | Auditoria WhatsApp + plano | P1 | ~1h (auditoria) + execução depois | Risco de regressão / quebrar a integração |
| **1** | Tempo de acesso ao plano | P1 | ~2h | Sim (impede gestão real de assinaturas) |
| **3** | Cards clicáveis + impersonate | P2 | ~4h | Não (debug fica chato) |
| **2** | Botão Admin no nav | P3 | ~30min | Não (puramente UX) |

**Sugestão de ordem de execução:**
1. **Demanda 4 (auditoria WhatsApp)** primeiro — porque toda mudança no Admin pode interferir e o sistema está numa zona de risco operacional após a migração.
2. **Demanda 1** — entrega valor de gestão imediato (trial / extensão de planos).
3. **Demanda 2** — junto com 3, ou separado (rápido).
4. **Demanda 3** — maior esforço, fazer por último.

---

## Próximo passo

Sidney indica:
1. **Por onde começar** (Demanda 4? Demanda 1? Outra ordem?)
2. Se quer que cada demanda vire **um plano-de-execução próprio** (`plano-execucao-demanda-N.md`) ou **agrupar tudo num único plano**.
3. Se há **prazo** ou só executar em ordem confortável.
