# Smoke Test Manual — Guia Passo-a-Passo

> **Para:** Sidney
> **Quando executar:** após cada deploy de produção, ou ao final de uma rodada grande de correções (como o Bloco K1 do plano de fechamento).
> **Tempo total estimado:** ~25 min (sem itens opcionais), ~40 min (com tudo).
> **Última versão:** 2026-05-04

---

## Como usar este guia

- Está dividido em **6 sessões curtas** (3–8 min cada).
- Cada sessão tem **itens numerados** (`1.1`, `1.2`, …).
- Marque cada item ao executar:
  - `[x]` passou
  - `[ ]` ainda não fiz
  - `[!]` falhou (anote o que falhou)
- Sessões podem ser executadas em ordem ou no dia que sobrar tempo. **Sessão 1 (Login) é pré-requisito** das outras (precisa estar logado).
- Itens marcados com 🟡 são **opcionais** — pulam-se sem culpa.

---

## Preparação (2 min)

Antes de começar qualquer sessão:

- [ ] Abrir **aba anônima** (Ctrl+Shift+N no Chrome/Edge; Ctrl+Shift+P no Firefox)
- [ ] Acessar [eidosform.com.br](https://eidosform.com.br)
- [ ] Ter à mão:
  - Seu email (`sidney@institutoeidos.com.br` ou `medeiros.sco@gmail.com`)
  - Um número de WhatsApp válido (preferencialmente o seu)
  - Email externo (Gmail pessoal) pra testar notificação chegando
  - DevTools aberto (F12) — aba **Network** vai ajudar nas Sessões 2 e 5

---

## Sessão 1 — Autenticação (3 min)

### 1.1 — Login normal
- [ ] Em `/login`, fazer login com seu email
- [ ] Redireciona pra `/forms` (dashboard)
- [ ] Sem erros visíveis no console (F12 > Console)

### 1.2 — Login com email não-existente (anti-enumeration)
- [ ] Logout
- [ ] Tentar login com `nao-existe-aleatorio@teste.com` + senha qualquer
- [ ] **Esperado:** mensagem genérica `E-mail ou senha incorretos`
- [ ] **NÃO esperado:** mensagem do tipo "esse email não está cadastrado"

### 1.3 — Login com senha errada (conta válida)
- [ ] Tentar login com seu email + senha errada
- [ ] **Esperado:** **mesma** mensagem genérica de 1.2 (`E-mail ou senha incorretos`)
- [ ] **NÃO esperado:** dica de "senha incorreta" / "tente recuperar"

### 1.4 — Rate limit
- [ ] Tentar login com senha errada 6 vezes seguidas (rápido)
- [ ] **Esperado:** após a 5ª, aparece "Too many login attempts" ou similar
- [ ] Aguardar 1 minuto antes de tentar logar de verdade (rate limit ainda ativo)

### 1.5 — Login válido + redireciona
- [ ] Login com email + senha corretos
- [ ] Aterrissa em `/forms`
- [ ] Header mostra seu nome / avatar

🟡 **1.6 (opcional) — Magic Link** — se sua conta tiver, faça `/login` > "Receber link" > clica no link no email > deve cair em `/forms`.

🟡 **1.7 (opcional) — Google OAuth** — se sua conta tiver, faça `/login` > "Entrar com Google" > deve cair em `/forms`.

---

## Sessão 2 — Quota Card no Dashboard (1 min)

### 2.1 — PlanQuotaCard visível
- [ ] Estar em `/forms` (logado)
- [ ] **Esperado:** card no topo mostrando: nome do plano, barra de progresso de respostas, contagem de formulários
- [ ] Card NÃO está vazio (números aparecem)

### 2.2 — Cores da barra
- [ ] Se você está em < 80% da quota: barra **azul/verde**
- [ ] Se está em 80-90%: barra **âmbar**
- [ ] Se está em > 90%: barra **vermelha** + card de upsell aparece

🟡 **2.3 (opcional) — Forçar 80%+** — só se quiser testar o upsell. Crie/duplique formulários até bater o limite.

---

## Sessão 3 — Submeter form público (8 min)

### Preparação da sessão
- [ ] Criar form novo em `/forms/new` (ou usar um já existente, mas precisa estar **published**)
- [ ] Adicionar pelo menos 5 perguntas variadas (mistura de tipos):
  - 1× `short_text`
  - 1× `email`
  - 1× `dropdown` (com 3 opções)
  - 1× `rating`
  - 1× `long_text`
- [ ] Em **Configurações** ou **Integrações**:
  - Ativar "Notificar email" → seu email externo (Gmail pessoal)
  - Ativar "Notificar WhatsApp" → seu número
- [ ] **Publicar** o formulário
- [ ] Copiar o link público (`/f/<slug>`)

### 3.1 — Player carrega
- [ ] Abrir o link público em **outra aba anônima** (sem login)
- [ ] Tela de boas-vindas (welcome) aparece, ou primeira pergunta
- [ ] Sem erro 404 / "form não encontrado"

### 3.2 — Contador de perguntas (Etapa 13)
- [ ] Avança até a primeira pergunta de verdade
- [ ] **Esperado:** "Pergunta 1 de N" (sem mostrar contagem dupla "1 de 18 (17 total)")

### 3.3 — Validação inline
- [ ] Em uma pergunta `email`, digitar `nao-é-email`
- [ ] Pressionar Enter
- [ ] **Esperado:** erro inline "email inválido", e a página **scrolla para mostrar o erro** (Etapa 13)

### 3.4 — Hint Ctrl+Enter em `long_text`
- [ ] Avança até pergunta `long_text`
- [ ] **Esperado:** hint visível "Pressione Ctrl+Enter ↵" (não só "Enter ↵")
- [ ] Pressionar Enter no meio do texto: NÃO deve avançar (deve fazer quebra de linha)
- [ ] Pressionar Ctrl+Enter: avança

### 3.5 — Submeter
- [ ] Preencher todas as perguntas e submeter
- [ ] **Esperado:** tela de "Obrigado" aparece
- [ ] Sem erro 500

### 3.6 — Resposta no dashboard
- [ ] Voltar pra aba logada
- [ ] Ir em `/forms/<id>/responses`
- [ ] **Esperado:** a resposta que você acabou de submeter aparece na lista

🟡 **3.7 — Os 18 tipos de pergunta** — se quiser cobertura total, crie um form com cada tipo:
- [ ] `short_text` — Enter avança
- [ ] `long_text` — Ctrl+Enter avança
- [ ] `email` — valida formato
- [ ] `phone` — seletor de país, formato BR
- [ ] `number` — só aceita número, min/max
- [ ] `dropdown` — abre, seleciona, avança
- [ ] `checkboxes` — múltipla, required exige ≥ 1
- [ ] `multiple_choice` — única escolha
- [ ] `rating` — clica estrela, avança
- [ ] `opinion_scale` — clica valor
- [ ] `nps` — escala 0-10
- [ ] `date` — picker abre
- [ ] `file_upload` — upload aceita imagem (BUG-EXTRA-1 corrigido)
- [ ] `address` — campos preenchem
- [ ] `url` — valida http/https
- [ ] `cpf` — valida dígito
- [ ] `content_block` — exibe HTML, avança
- [ ] `calendly` — widget carrega
- [ ] `payment` — checkout Asaas (se configurado)

---

## Sessão 4 — Notificações Email + WhatsApp (5 min)

> Roda imediatamente após Sessão 3.

### 4.1 — Email do owner
- [ ] Abra a inbox do email externo (Gmail pessoal) que você configurou no form
- [ ] **Esperado:** email "Nova resposta em '...'" chegou
- [ ] Sem cair em SPAM
- [ ] Headers (clica nos 3 pontos > "Mostrar original" no Gmail) mostram:
  - `Authentication-Results: spf=pass; dkim=pass`
- [ ] Subject **NÃO** contém PII (CPF, email, telefone, ou strings com mais de 50 chars)
- [ ] Link "Ver resposta" no corpo abre o dashboard correto

### 4.2 — WhatsApp do owner
- [ ] Abra o WhatsApp no celular cujo número você configurou
- [ ] **Esperado:** mensagem chegou em até ~30s
- [ ] Texto está bem formatado (sem caracteres estranhos / quebrado)
- [ ] Variáveis substituídas (`{nome}`, `{email}`, etc) — não há `{` literal no texto

### 4.3 — Idempotência (não duplicar)
- [ ] Aguarde 30 segundos
- [ ] **Esperado:** **NÃO** chegar 2º email / 2º WhatsApp da mesma resposta

### 4.4 — Rate limit WhatsApp por form
- [ ] Submeter 5 respostas seguidas no MESMO form com o MESMO telefone
- [ ] **Esperado:** primeiras chegam, mas depois de N (configurado) param de chegar (rate limit por chave `formId:phone`)
- [ ] Se submeter no MESMO telefone mas em OUTRO form, recebe normalmente

🟡 **4.5 (opcional) — Logs de PII** — abrir Vercel logs, buscar pelo response_id da submissão. Confirmar:
- [ ] Telefone aparece como hash (após Etapa H1) ou redacted, não em texto cru
- [ ] Email do respondente não aparece cru em logs

---

## Sessão 5 — Webhook de saída (5 min)

> Precisa de um endpoint público pra receber. Use [webhook.site](https://webhook.site) (gratuito, gera URL única).

### Preparação
- [ ] Abrir [webhook.site](https://webhook.site) → copiar a URL única (algo tipo `https://webhook.site/abc-def-123`)
- [ ] No form criado na Sessão 3: `/forms/<id>/edit` > aba **Integrações** > Webhook URL > colar

### 5.1 — Submeter resposta + webhook chega
- [ ] Submeter nova resposta no form
- [ ] **Esperado:** em até ~5s, aparece um POST em `webhook.site`

### 5.2 — Headers de segurança no webhook
Inspecionar headers do POST:
- [ ] `X-EidosForm-Event: form.response`
- [ ] `X-EidosForm-Form-Id: <uuid>`
- [ ] `X-EidosForm-Signature: sha256=...` (HMAC válido)
- [ ] `X-EidosForm-Timestamp: <ISO>`
- [ ] Body é JSON com `event`, `form_id`, `response_id`, `created_at`, `data`, `fields`

### 5.3 — Idempotência da assinatura entre retries
- [ ] Forçar falha: trocar URL pra algo inválido tipo `https://webhook.site/abc-def-123/404` (404 garantido)
- [ ] Submeter resposta
- [ ] Em `webhook.site`, ver as 4 tentativas (timestamp do request) — todos devem ter **a mesma signature** (não muda entre retries)

🟡 **5.4 — DLQ + alerta de falha (Etapa J1)** — só ativável se você simular 3+ falhas em 7 dias:
- [ ] Manter URL inválida ativa
- [ ] Submeter 3+ respostas em 7 dias (ou alterar manualmente o `created_at` em `webhook_failures` no Supabase)
- [ ] **Esperado:** email "[EidosForm] Webhook do formulário '...' falhando" chega ao owner
- [ ] Tabela `webhook_failure_notifications` no Supabase tem 1 linha pro `form_id`
- [ ] Submeter mais 1: NÃO chega 2º email (anti-spam 24h)

🟡 **5.5 — Ataque CSRF bloqueado** — DevTools > Console:
```js
await fetch('https://eidosform.com.br/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.com' },
  body: JSON.stringify({ email: 'x@x.com', password: 'y' })
}).then(r => r.status)
```
- [ ] **Esperado:** retorna `403`

---

## Sessão 6 — Builder & gestão (3 min)

### 6.1 — Editar form existente
- [ ] `/forms/<id>/edit`
- [ ] Trocar título e salvar
- [ ] Recarregar página: título atualizado persiste

### 6.2 — Reordenar perguntas
- [ ] No builder, arrastar uma pergunta pra outra posição
- [ ] Salvar
- [ ] Abrir player público: ordem nova respeitada

### 6.3 — Publicar / Fechar
- [ ] Despublicar → `published` vira `closed` (ou similar)
- [ ] Acessar link público: aparece "formulário fechado" (não 404)
- [ ] Republicar: link público volta a abrir

### 6.4 — Duplicar / Deletar
- [ ] Duplicar form: novo aparece na lista com sufixo "(cópia)" ou similar
- [ ] Deletar a cópia: some da lista após confirmação
- [ ] Confirmar que respostas e form original NÃO foram afetados

🟡 **6.5 — Folders** — criar pasta, mover form, mover de volta. Ver `auditoria-uso-fase1.md` § P3 do dashboard.

🟡 **6.6 — Exportar CSV / PDF** — em `/forms/<id>/responses` > "Exportar". Arquivo baixa OK.

🟡 **6.7 — API Key** — em `/settings` > seção "API Key" > clicar "Gerar chave". Esperado: gera chave + permite copiar (Etapa 14 — não deve mais retornar 404 "Profile not found").

---

## Sessão 7 — Acessibilidade rápida (2 min) 🟡 OPCIONAL

### 7.1 — Navegação só por teclado no player
- [ ] No player público, navegar apenas com Tab + Enter + setas
- [ ] Conseguir avançar e voltar nas perguntas
- [ ] Sem ficar preso em nenhuma pergunta

### 7.2 — Selects e labels no builder
- [ ] No builder, inspecionar (F12) os `<select>` da seção de perguntas e lógica condicional
- [ ] **Esperado:** todos têm `aria-label` ou `id` + `htmlFor` correspondente

---

## Como reportar resultados

Ao final, abra um issue ou me responda no chat com o resumo:

```markdown
## Smoke Test 2026-XX-XX

### Sessões executadas
- [x] 1 (Auth)
- [x] 2 (Quota)
- [x] 3 (Player)
- [x] 4 (Notif)
- [x] 5 (Webhook)
- [x] 6 (Builder)

### Falhas encontradas
- 3.4 — hint Ctrl+Enter aparece mas Enter sozinho também avançou (esperado: NÃO avançar)
- 4.1 — email caiu em SPAM (Gmail) — possível impacto da pendência DNS I1

### Itens não testados
- 3.7 — não testei `calendly` nem `payment`
- 5.4 — não simulei DLQ
```

---

## Dicas de produtividade

1. **Use 2 monitores** (ou 2 janelas em monitor grande): uma com este checklist, outra com a aba anônima do EidosForm.
2. **DevTools sempre aberto** (Ctrl+Shift+I) — aba Network no filtro `Fetch/XHR` mostra todas as requisições.
3. **Aba Console** mostra erros JS em tempo real. Se aparecer vermelho lá durante uso normal, é bug.
4. **Evite o cache:** Ctrl+Shift+R (hard reload) entre sessões.
5. **Salve screenshots de qualquer falha** com `Win+Shift+S` (Windows) ou `Cmd+Shift+5` (Mac).
6. **Não execute em horário de pico** (clientes reais usando) — use madrugada ou começo da manhã.

---

## Critério de "smoke test passou"

✅ Sessões 1, 3, 4 e 5 com todos os itens não-🟡 marcados `[x]`.
⚠️ Sessões 2 e 6 com pelo menos 80% marcados `[x]`.
❌ Qualquer falha em 1.x, 3.5, 4.1, 4.2 ou 5.1 = **bloqueio** (abrir bug imediatamente).

Falhas em itens 🟡 = anotar mas não bloqueiam.
