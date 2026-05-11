# Plano de Execução — Backlog 2026-05-04

> **Origem:** [backlog-demandas-2026-05-04.md](backlog-demandas-2026-05-04.md)
> **Para:** Zé / OpenClaw / Claude Code
> **Branch sugerida:** `feat/admin-whatsapp-2026-05`
> **Ordem proposta:** Demanda 4 → 1 → 2 → 3

---

## Como trabalhar

1. **Uma demanda por vez.** Cada demanda tem seus próprios blocos.
2. **Branch única para todas as demandas** (`feat/admin-whatsapp-2026-05`) ou uma por demanda (Sidney escolhe).
3. **Conventional commits em inglês** (`feat:`, `fix:`, `chore:`, `docs:`).
4. **Após cada demanda concluída:**
   - Entrada no relatório `relatorio-execucao-backlog-2026-05-04.md`
   - Smoke test específico do que mudou
   - Commit + push
5. **Achados extras descobertos:** anotar em `achados-extras-backlog.md` e seguir.

---

## Demanda 4 — Auditoria completa do WhatsApp

> **Severidade:** P1 — risco operacional alto.
> **Tempo estimado:** ~1h auditoria + (correções variam, depende dos achados).
> **Por que primeiro:** sistema está numa zona de risco após a migração; toda outra mudança pode interferir.

### BLOCO L — Auditoria estática (read-only)

#### Etapa L1 — Inventário de paths

**O que fazer:** mapear TODOS os arquivos/configs/scripts que referenciam paths do whatsapp.

**Comandos:**
```bash
# Repo
grep -rn "eidosform-whatsapp\|services/whatsapp" /home/sidney/eidosform \
  --include="*.{ts,tsx,js,json,md,sh,conf}" 2>/dev/null

# PM2
sudo -u sidney pm2 show eidosform-whatsapp
cat /home/sidney/.pm2/dump.pm2 2>&1 | jq '.[] | {name, cwd, script, env_file}'

# Nginx
sudo cat /etc/nginx/sites-enabled/eidosform-whatsapp-api
sudo nginx -T 2>&1 | grep -E "whatsapp|wpp.eidosform"

# Env
ls -la /home/sidney/eidosform/services/whatsapp/.env
ls -la /home/sidney/eidosform-whatsapp/ 2>&1
sudo crontab -l 2>&1 | grep -i whatsapp
systemctl list-units 2>&1 | grep -i whatsapp
ls /etc/logrotate.d/eidosform-whatsapp

# Vercel env (precisa Vercel CLI ou painel)
# vercel env ls
```

**Saída:** tabela `path → onde aparece → status (✅/⚠️/❌)`.

**Critério de done:** todos os paths catalogados; ≥1 inconsistência identificada (sabemos que existe pelo menos `LOG_FILE` errado).

---

#### Etapa L2 — Auditoria do código `services/whatsapp/server.js`

**Verificar:**
- Hardcoded paths apontando pra fora do diretório (já achado: `LOG_FILE = '/home/sidney/eidosform-whatsapp/server.log'` linha 11).
- Tratamento de erro (try/catch, retries, logs).
- Segurança (auth Bearer, rate limit, validação de entrada).
- Vazamentos de PII em logs (após Etapa H1 — confirmar que está completo).
- Coerência de dependências (`package.json`, `node_modules`).
- Endpoints documentados (`/api/whatsapp/qr`, `status`, `send`, `disconnect`) vs implementados.
- `LOG_FILE` deveria estar em `services/whatsapp/logs/server.log` (consistente com pm2 ecosystem) ou usar console-only.

**Saída:** lista de achados de código.

**Critério de done:** cada função inspecionada; pelo menos os 4 endpoints REST validados; lista de achados documentada.

---

#### Etapa L3 — Auditoria das integrações (TypeScript)

**Arquivos:**
- `lib/integration-stubs.ts`
- `app/api/whatsapp/send/route.ts`
- `app/api/whatsapp/qr/route.ts`, `app/api/whatsapp/status/route.ts`, `disconnect/route.ts`
- `lib/whatsapp-templates.ts` (se existir)
- `app/(dashboard)/admin/whatsapp/*` (admin UI)
- `app/api/admin/whatsapp/*` (admin API)
- Schema da tabela `form_whatsapp_logs`

**Verificar:**
- URL base do serviço VPS (`process.env.WHATSAPP_API_URL` ou hardcoded).
- Auth header (`INTERNAL_API_SECRET`).
- Tratamento de erro nas chamadas fetch.
- Tabela `form_whatsapp_logs`: schema, RLS, está sendo populada corretamente?
- **Por que o admin mostra `unknown` / `Formulário sem título` em "Últimos envios"** (achado urgente).

**Investigar especificamente:**
```bash
# Inspecionar logs gravados
psql ... -c "select form_id, phone_number, status, error_message, created_at from form_whatsapp_logs order by created_at desc limit 10"
# Cruzar com forms — quantos retornam 'unknown'?
psql ... -c "select count(*) from form_whatsapp_logs l left join forms f on l.form_id = f.id where f.id is null"
```

**Saída:** lista de achados + diagnóstico do "unknown / Formulário sem título".

---

#### Etapa L4 — Auditoria operacional (VPS + nginx + DNS)

**Verificar na VPS:**
- Estado real do `/home/sidney/eidosform-whatsapp/` — existe? tem arquivos? referenciado em algum lugar?
- Logs em `/home/sidney/eidosform-whatsapp/server.log` — size, ainda escreve, rotaciona?
- PM2 dump — só 1 daemon (sidney), sem zombie do root.
- Nginx upstream (timeout, headers — já validei H2; reconfirmar pós-deploy).
- DNS `wpp.eidosform.com.br` (A record correto, certificado válido, HTTPS forçado).
- Permissões e ownership dos arquivos.
- Cron jobs / timers / systemd units.
- Espaço em disco (`server.log` tem 56MB hoje — logrotate funciona?).

**Saída:** lista de resíduos a limpar e configurações inconsistentes.

---

#### Etapa L5 — Consolidar relatório

**Saída:** `auditoria-whatsapp-2026-05-04.md` no padrão das fases anteriores:
- Sumário executivo (totais P0/P1/P2/P3).
- Achados detalhados por seção (código, paths, ops, schema, admin UI).
- Tabela "Top 20 prioridades".
- Recomendações para o agente que vai corrigir.
- Apêndice — arquivos consultados.

---

### BLOCO M — Plano de correção

#### Etapa M1 — Gerar plano de execução

**A partir do relatório L5**, gerar `plano-execucao-correcao-whatsapp.md`:
- Etapas numeradas com escopo claro.
- Critério de done por etapa.
- Validação por etapa.
- Ordem de execução (do mais crítico ao menos).
- Estimativa de tempo.

---

### BLOCO N — Execução das correções (placeholder — depende do M1)

Será detalhado em M1.

**Provável escopo (baseado em sintomas conhecidos):**
- Corrigir `LOG_FILE` no server.js para usar path do monorepo.
- Limpar `/home/sidney/eidosform-whatsapp/` se nada referencia mais.
- Documentar deploy operacional do whatsapp service em `docs/whatsapp-deploy.md`.
- Corrigir lookup de form em "Últimos envios" no admin.
- Adicionar healthcheck endpoint que cobre wacli (não só fastify).

---

## Demanda 1 — Tempo de acesso ao plano (Admin)

> **Severidade:** P1 — bloqueia gestão real de assinaturas.
> **Tempo estimado:** ~2h.

### Etapa P1.1 — Investigar schema atual

**Comandos:**
```sql
-- Schema da profiles
\d profiles

-- Procurar colunas que armazenam expiração
select column_name, data_type from information_schema.columns
where table_name = 'profiles' and (column_name like '%expir%' or column_name like '%until%' or column_name like '%end%');
```

**Saída:** confirmar nome exato da coluna (provável `plan_expires_at`).

---

### Etapa P1.2 — Inspecionar endpoint admin existente

**Arquivo:** `app/api/admin/users/[id]/plan/route.ts` (provável).

**Verificar:**
- Parâmetros aceitos hoje (só `plan` ou já tem `expires_at`?).
- Lógica de validação.

---

### Etapa P1.3 — Estender endpoint para aceitar data

**Mudança:**
```typescript
// Antes
{ plan: 'plus' }

// Depois
{ plan: 'plus', expiresAt: '2026-08-01T00:00:00Z' | null }
```

- Se `expiresAt` ausente: usar default por plano (Free = null, Plus/Professional = +30 dias).
- Validar data: deve ser futura (≥ hoje).

---

### Etapa P1.4 — UI: calendário de dias

**Arquivo:** `app/(dashboard)/admin/users/page.tsx` (ou modal "Alterar plano").

**Componente:**
- Date picker (usar shadcn/ui `Calendar` se já importado, ou pacote `date-fns` + `react-day-picker`).
- Atalhos: "+7 dias", "+30 dias", "+90 dias", "Sem expiração".
- Mostrar data atual de expiração se houver.

---

### Etapa P1.5 — Validar fluxo end-to-end

**Smoke:**
- Admin define expiração para amanhã → cron/lógica de expiração reverte para free.
- Admin define `null` → plano não expira.
- Mudar plano sem mexer expiração → expiração mantida.

---

## Demanda 2 — Botão Admin no nav

> **Severidade:** P3 — UX.
> **Tempo estimado:** ~30min.

### Etapa P2.1 — Identificar onde fica o nav

**Arquivos prováveis:**
- `components/dashboard/nav.tsx`
- `app/(dashboard)/layout.tsx`

### Etapa P2.2 — Adicionar item condicional

```tsx
{user?.is_admin && (
  <Link href="/admin" className="...">
    <Shield className="w-4 h-4" />
    Admin
  </Link>
)}
```

- Confirmar como `is_admin` é exposto no client (provavelmente via context/profile fetch).
- Garantir que o link **não aparece** em SSR pra users não-admin (não vazar pista).

### Etapa P2.3 — Validar

- Logado como `medeiros.sco@gmail.com` → botão aparece.
- Logado como user comum → botão não aparece.

---

## Demanda 3 — Cards clicáveis + drill-down + impersonate

> **Severidade:** P2 — gestão e suporte.
> **Tempo estimado:** ~4h.

### Etapa P3.1 — Cards clicáveis

**Arquivo:** `app/(dashboard)/admin/page.tsx` (ou o que renderiza Métricas Gerais).

**Mudança:**
- Cards atuais: `<Card>...</Card>` → envolver em `<Link href="/admin/users">`, `<Link href="/admin/forms">`, `<Link href="/admin/responses">`.
- Hover state pra indicar clicabilidade.

### Etapa P3.2 — Listagem de Forms (`/admin/forms`)

**Nova rota:** `app/(dashboard)/admin/forms/page.tsx`

**Conteúdo:**
- Tabela com: título, dono (email), nº de respostas, status, criado em.
- Filtros: por dono, status, data.
- Busca por título.
- Ações: "Ver como dono" (impersonate).

### Etapa P3.3 — Listagem de Responses (`/admin/responses`)

**Nova rota:** `app/(dashboard)/admin/responses/page.tsx`

**Conteúdo:**
- Tabela com: form (link), respondente (anonimizado se sensível), data, completou?
- Filtros: por form, data.
- Ações: "Abrir resposta" (modal ou nova página).

### Etapa P3.4 — Impersonate ("view as user")

**Estratégia escolhida (a confirmar com Sidney):**

**Opção A — Cookie de sessão temporária:**
- Endpoint `/api/admin/impersonate/[user_id]` gera cookie `x-impersonate-as` com user_id assinado (HMAC).
- Middleware lê cookie, sobrescreve `auth.uid()` no contexto.
- Banner global "Você está visualizando como X — [Sair]".
- RLS continua respeitando o `auth.uid()` impersonado.

**Opção B — Páginas admin separadas (mais simples):**
- `/admin/users/[id]/forms`, `/admin/users/[id]/responses`.
- Server-side usa `service_role` para buscar dados.
- UI similar ao dashboard do dono, mas read-only com banner "Você está vendo como Admin os dados de X".
- Sem alteração de RLS / sessão.

**Recomendação:** Opção B é mais segura e fácil. Opção A só vale a pena se o admin precisar **interagir** (clicar em integrações, debugar webhook, etc.).

### Etapa P3.5 — Smoke

- Click em "Total de usuários" → lista correta.
- Click em "Total de forms" → lista de TODOS os forms.
- Click em "Ver como dono" → entra no painel do dono.
- Sair do impersonate → volta para `/admin` normal.

---

## Resumo do plano

| Demanda | Bloco | Etapas | Tempo |
|---|---|---|---|
| **4 — Auditoria WhatsApp** | L (auditoria) + M (plano) + N (correção) | L1-L5 + M1 + N\* | ~1h + execução |
| **1 — Tempo plano** | P1 | P1.1 → P1.5 | ~2h |
| **2 — Botão Admin** | P2 | P2.1 → P2.3 | ~30min |
| **3 — Cards/impersonate** | P3 | P3.1 → P3.5 | ~4h |

**Total bruto:** ~7-8h de trabalho assistido por agente.
**Sequência sugerida:** 4 → 1 → 2 → 3.

---

## Quando começar?

Sidney confirma:
1. **Sequência:** mantém 4 → 1 → 2 → 3 ou prefere outra?
2. **Granularidade:** branch única ou uma por demanda?
3. **Início:** começar agora (Demanda 4 / Bloco L) ou agendar para depois?
