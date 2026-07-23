# Briefing — Feature: Campos ocultos via URL (hidden fields / url_params)

> **Para:** análise do Codex e, após feedback, implementação pelo Claude Code no repo `/home/sidney/eidosform` (branch `main`).
> **Escopo:** feature de PRODUTO do EidosForm, para todos os clientes (paridade com "hidden fields" do Typeform). Nenhuma referência a cliente/lançamento específico em código, nomes ou testes.
> **Decisor:** Sidney (dono do produto).
> **Status:** AGUARDANDO feedback do Codex — nada foi implementado.

## 1. O que é e por quê

Hoje o player do EidosForm captura **apenas** os parâmetros `utm_*` da URL (`lib/utm-tracker.ts`) e os grava na response (colunas `utm_source|medium|campaign|term|content`). Qualquer outro parâmetro é ignorado.

A feature: capturar **parâmetros adicionais da URL** (ex.: `?nome=Fulano&email=x%40y.com&telefone=5583...`), gravá-los na response e propagá-los para a planilha Google/exports — permitindo que um funil que já conhece o lead (página de captura → redirect para o form com os dados na query string) vincule a resposta ao lead **sem repetir perguntas**.

Caso de uso validado: funil de lançamento onde a página de captura redireciona para uma página de qualificação com `?nome=...&email=...&telefone=...` — mecanismo que operou com **100% de cobertura e 100% de match por e-mail** no último lançamento (1.371 respostas, zero órfãs). A feature traz esse padrão para dentro do EidosForm.

## 2. Modelo de dados

Nova coluna em `responses`:

```sql
-- supabase/migrations/20260707_responses_url_params.sql
alter table public.responses add column if not exists url_params jsonb;
```

- `url_params`: objeto plano `{ [chave: string]: string }`. `null`/ausente quando o lead chega sem parâmetros extras.
- **Migrations são aplicadas MANUALMENTE** no Supabase (SQL Editor) — não há CI de migration. O código deve ser **tolerante à coluna ainda não existir**? NÃO: sequência de deploy definida = aplicar migration ANTES do push (coluna extra não quebra o código antigo; código novo só entra com a coluna já criada).

## 3. Captura no player

Novo módulo (ou extensão do `lib/utm-tracker.ts`, mantendo o padrão do arquivo):

- **O que captura:** todos os parâmetros da query string, EXCETO:
  - os `utm_*` (já têm pipeline próprio);
  - denylist de tracking/ruído: `fbclid`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `msclkid`, `mcp_token`, `igshid`, `ref`, `_hsenc`, `_hsmi` (lista exportada, fácil de estender).
- **Sanitização (client E servidor):**
  - chave: regex `^[a-zA-Z0-9_-]{1,40}$` (fora disso, descarta);
  - valor: `trim()`, máx. **200 chars** (mais longo = descarta a chave inteira — provável token/lixo, não truncar silenciosamente);
  - máx. **10 chaves** por response (ordem da URL, excedente descartado);
  - valores vazios descartados.
- **Persistência client:** `sessionStorage` APENAS (chave própria, ex.: `eidosform_url_params_<formId>`), capturado no mount do player — sobrevive à navegação interna do form. **DIFERENTE dos UTMs, NÃO usar localStorage/30 dias**: identidade pessoal não pode "vazar" entre visitas/pessoas num dispositivo compartilhado (UTM é atribuição de campanha; url_params é identidade).
- **Escopo por form** (`<formId>` na chave do storage) — dois forms abertos na mesma sessão não misturam identidades.

## 4. Envio e API

- **Submit final** (`form-player.tsx` → POST `/api/responses`): incluir `url_params` no body.
- **Parciais** (`/api/responses/partial` + `navigator.sendBeacon`): incluir também — identidade preservada mesmo em abandono (valioso para remarketing/lembrete). O caminho de upgrade parcial→final não pode perder o valor.
- **Validação server-side** (nos dois endpoints): re-sanitizar com as MESMAS regras do §3 (não confiar no client): objeto plano, ≤10 chaves, chave no regex, valor string ≤200. Params inválidos são **descartados silenciosamente** (fail-open) — nunca rejeitam o submit. `url_params` vazio → gravar `null` (não `{}`).
- Atenção ao padrão existente: o route já faz filtragem manual de `meta_events` (`app/api/responses/route.ts:133`) — seguir o mesmo estilo.

## 5. Planilha Google (lib/google-sheets.ts)

- **Layout de header para planilha nova:** `Data/Hora | nome | email | telefone | response_id | status | <perguntas...> | meta_events | UTMs` — as três colunas de identidade em **B, C e D** (requisito do dono do produto).
- As colunas `nome`/`email`/`telefone` são SEMPRE criadas no header (mesmo que o form nunca receba os params) — layout estável.
- Valores preenchidos a partir de `url_params.nome`, `url_params.email`, `url_params.telefone` (case-sensitive nas chaves; documentar). **Outras chaves de url_params NÃO ganham coluna no Sheets na v1** (ficam no banco/CSV) — evita header dinâmico imprevisível.
- **Planilha vinculada ANTES da feature:** a integração mapeia colunas por NOME de header já existente (`existingHeaders.indexOf`) — headers antigos não têm o trio. Definir comportamento: (a) documentar que é preciso re-vincular/limpar a aba, ou (b) lógica de auto-inserção das colunas faltantes no header existente. Preferência do dono: avaliar (b) se for barato/seguro; senão (a) com aviso claro. **Ponto para o Codex opinar.**
- Cuidado com `values.append`: nada de pré-escrever fórmulas/valores em linhas futuras (regra já aprendida — buffers quebram a detecção de tabela do append).

## 6. Exports e exibição

- **CSV (`export-csv` e `export`):** adicionar colunas `nome`, `email`, `telefone` (de `url_params`), na mesma posição lógica (após Data/Submetido). Demais chaves de url_params: fora da v1.
- **Dashboard de respostas:** fora do escopo v1 (opcional exibir no detalhe da response depois).
- **Webhook de integração** (se o form tiver `webhook_url`): verificar onde o payload é montado e incluir `url_params` completo (é JSON, custo zero). Confirmar na implementação.

## 7. Segurança e privacidade

- PII (e-mail/telefone) em query string é decisão do CLIENTE do EidosForm (o funil dele já opera assim); o produto apenas captura. NÃO logar valores de `url_params` em console/logs do servidor.
- Sanitização server-side obrigatória (XSS via planilha/CSV: os valores entram em células — conferir se `sanitize-formula.ts`/`sanitizeCellValue` já cobre injeção de fórmula `=...` nos exports e aplicar o mesmo tratamento às novas colunas).
- RLS: coluna nova na tabela `responses` herda as políticas existentes — sem mudança de política.

## 8. O que reaproveitar (não recriar)

- Padrões de `lib/utm-tracker.ts` (sessionStorage, sanitize, capture-on-mount).
- `getUtms()`/`captureUtms()` como referência de integração no player (`form-player.tsx` linhas ~553 e ~660).
- Mapeamento por header em `lib/google-sheets.ts` (`finalHeaders.map`) e a constante `META_EVENTS_COLUMN` como modelo para as novas colunas.
- Sanitização de célula existente nos exports (`sanitizeCellValue` / `escapeCSV`).

## 9. Validação E2E (produção, após deploy)

1. `npx tsc --noEmit` + `npx eslint <alterados>` + `npx vitest run` limpos.
2. Aplicar migration no Supabase (manual) ANTES do push.
3. Form de teste publicado + planilha vinculada nova: abrir `/f/<slug>?nome=Teste+Silva&email=teste%40ex.com&telefone=5583999990000&utm_source=teste` → responder → conferir:
   - response no banco com `url_params` = `{nome, email, telefone}` e UTMs intactas;
   - planilha com nome/email/telefone em B/C/D e UTMs nas colunas de UTM;
   - CSV export com as 3 colunas;
   - submit SEM parâmetros → colunas vazias, nada quebra;
   - parcial abandonada com params → row parcial com `url_params`.
4. Teste de lixo: `?nome=<script>alert(1)</script>&email==HYPERLINK(...)&hack=<600 chars>` → valores sanitizados/descartados, planilha sem fórmula injetada.

## 10. Restrições e gotchas do repo

- **NÃO rodar `npm run build` local** (OOM na VPS). Usar `npx tsc --noEmit` + `npx eslint` + `npx vitest run`.
- Deploy = `git push` na `main` (Vercel auto-build). `git fetch` antes de conclusões sobre o remoto.
- Feature **inerte** para forms/URLs sem parâmetros extras — zero mudança de comportamento existente.
- Não tocar em billing/Asaas/webhook de pagamento.
- Há arquivos untracked de outras sessões em `docs/` e `scripts/` — não incluir nos commits.
- Testes: vitest já configurado (`npm run test`); adicionar unit tests da sanitização (client/server) e do mapeamento de colunas.

## 11. Fora do escopo desta feature (contexto)

O consumidor imediato será uma planilha com 3 abas: leads da captura (aba 1), respostas do EidosForm (aba 2, esta feature) e uma aba "Consolidado" com fórmulas (QUERY/XLOOKUP por e-mail + score de qualificação) — montada FORA do produto, direto na planilha. Nada disso entra no código do EidosForm.

## 12. Relatório esperado da análise do Codex

(a) Furos de segurança/validação no desenho; (b) opinião sobre §5-(a) vs (b) (headers de planilhas já vinculadas); (c) riscos no fluxo parcial→final; (d) qualquer simplificação; (e) veredito: implementar como está ou com ajustes.

## 13. Adendo (2026-07-07) — ajustes aceitos do feedback Codex (a implementação segue ESTA versão)

1. **Função única `sanitizeUrlParams`** em `lib/url-params.ts`, compartilhada client/servidor (denylist, limites, chaves reservadas centralizados).
2. **Parâmetros repetidos:** vence o ÚLTIMO (`?email=a&email=b` → `b`).
3. **Casing:** exclusões (utm_*/denylist) case-insensitive; chaves normalizadas para MINÚSCULAS no armazenamento (`EMAIL` → `email` — também simplifica o mapeamento do Sheets).
4. **Prototype pollution:** bloquear `__proto__`, `prototype`, `constructor`; montar resultado com `Object.create(null)` e converter para objeto plano só na serialização.
5. **Limites:** máx. 10 chaves APÓS filtros; servidor inspeciona no máximo as 50 primeiras entradas do objeto bruto (payload gigante não é iterado inteiro).
6. **Ciclo de vida do sessionStorage:** URL com params válidos → substitui; URL sem params → reutiliza os da sessão; **submit final com sucesso → remove a chave** (sem identidade velha em resposta nova na mesma aba).
7. **Parcial→final (regra formal do servidor):** novo valor válido → atualiza; objeto vazio/ausente no upgrade → PRESERVA o existente (nunca sobrescreve com null); response nova sem valor → `null`. Testado explicitamente, incluindo beacon.
8. **Formula injection:** aplicar a sanitização de fórmula existente do repo às novas colunas no Sheets E no CSV (cobrir `=`, `+`, `-`, `@`); conferir `valueInputOption` do append (se USER_ENTERED, sanitização obrigatória). Critério do teste de lixo: valor **armazenado como texto e nunca interpretado** (não necessariamente descartado).
9. **Planilhas antigas: §5-(a)** — v1 exige re-vinculação/aba nova para ganhar `nome/email/telefone` em B/C/D; sem auto-inserção estrutural silenciosa. Migração opt-in fica para depois.
10. **Tipos Supabase:** atualizar `lib/database.types.ts` (Row/Insert/Update de `responses`).
11. **PII em URL:** conferir `Referrer-Policy` atual do app (não vazar query em Referer); NUNCA logar query string/url_params; `history.replaceState` pós-captura NÃO entra na v1 (risco de apagar `fbclid`/query antes do PageView do pixel — reavaliar como opção v2).
