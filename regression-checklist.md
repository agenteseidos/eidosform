# Checklist de Regressão — Etapa 19 / K1

> Gerado em 2026-05-03. Atualizado em 2026-05-04 com smoke tests automáticos via curl. Itens marcados `[x]` foram validados; `[ ]` exigem execução manual em browser/auth.

## Smoke tests automáticos rodados em 2026-05-04

```bash
# /api/auth/login com Origin atacante → 403 Forbidden ✅
curl -s -o /dev/null -w "%{http_code}" -X POST https://eidosform.com.br/api/auth/login \
  -H 'Origin: https://attacker.example.com' -H 'Content-Type: application/json' \
  --data '{"email":"x@x.com","password":"y"}'
# → 403

# Signup body idêntico para email novo vs existente ✅
curl -s -X POST https://eidosform.com.br/api/auth/signup -H 'Content-Type: application/json' \
  --data '{"email":"existing@example.com","password":"strongpwd123","fullName":"Test"}'
# → {"success":true,"message":"Verifique seu email para confirmar."}

# /api/responses não retorna 500 mais — agora 404 para form inexistente ✅
curl -s -o /dev/null -w "%{http_code}" -X POST https://eidosform.com.br/api/responses \
  -H 'Content-Type: application/json' \
  --data '{"form_id":"00000000-0000-0000-0000-000000000000","answers":{}}'
# → 404

# Headers de segurança nginx WhatsApp ✅
curl -sI https://wpp.eidosform.com.br/api/whatsapp/health \
  | grep -iE 'Strict-Transport|X-Content-Type|Referrer-Policy'
# → 3 headers presentes
```

---

## 1. Smoke test ponta-a-ponta (Etapa 3)

- [ ] Acessar `https://eidosform.com.br/f/` com um formulário publicado de teste
- [ ] Preencher todas as perguntas e submeter
- [ ] Confirmar tela "Obrigado" aparece
- [ ] Confirmar resposta aparece em `/forms/{id}/responses` no dashboard
- [ ] Confirmar email de notificação chega com `Authentication-Results: spf=pass; dkim=pass`
- [ ] Confirmar WhatsApp chega ao número configurado
- [ ] Confirmar webhook externo recebe POST com header `X-EidosForm-Signature`

---

## 2. Todos os 18 tipos de pergunta no player

- [ ] `short_text` — digita resposta, avança com Enter
- [ ] `long_text` — digita resposta, avança com Ctrl+Enter; botão "OK" visível
- [ ] `email` — validação de formato; Enter avança
- [ ] `phone` — seletor de país; formato correto
- [ ] `number` — aceita apenas número; min/max respeitados
- [ ] `dropdown` — abre select; seleciona opção; avança
- [ ] `checkboxes` — múltipla escolha; required valida se ao menos 1 selecionado
- [ ] `multiple_choice` — única escolha; avança ao clicar
- [ ] `rating` — clica estrela/número; avança
- [ ] `opinion_scale` — clica valor; avança
- [ ] `nps` — escala 0-10; avança
- [ ] `date` — picker abre; data selecionada; avança
- [ ] `file_upload` — upload de imagem/PDF; URL retornada
- [ ] `address` — campos preenchidos; avança
- [ ] `url` — validação de protocolo http/https
- [ ] `cpf` — validação de formato e dígito verificador
- [ ] `content_block` — exibe HTML sanitizado; botão avança ou abre link
- [ ] `calendly` — widget carrega; agendamento registrado
- [ ] `payment` — (se configurado) checkout Asaas abre; pagamento testado em sandbox

---

## 3. Dashboard — funcionalidades principais

- [ ] Login com Google OAuth redireciona para `/forms`
- [ ] Login com Magic Link chega por email e autentica
- [ ] Criar novo formulário (todos os campos)
- [ ] Editar formulário existente (title, slug, tema, perguntas)
- [ ] Reordenar perguntas (drag-and-drop)
- [ ] Publicar formulário → status muda para "published"
- [ ] Fechar formulário → status "closed"; player mostra mensagem de fechado
- [ ] Duplicar formulário
- [ ] Deletar formulário
- [ ] Criar pasta e mover formulário para pasta
- [ ] Visualizar respostas: tabela carrega, paginação funciona
- [ ] Exportar CSV de respostas
- [ ] Quota card mostra plano, respostas usadas/limite, formulários usados/limite
- [ ] Card de upsell aparece quando ≥ 80% da quota de respostas

---

## 4. Integrações

- [ ] Webhook de saída: submissão aciona POST com `X-EidosForm-Signature` válida
- [ ] Google Sheets: submissão adiciona linha na planilha configurada
- [ ] Email (Resend): notificação chega sem vazar PII no assunto
- [ ] WhatsApp: mensagem chega com Unicode correto (sem caracteres estranhos)
- [ ] Rate limit WhatsApp: segunda submissão rápida do mesmo form/telefone é bloqueada
- [ ] Idempotência Resend: retry não gera email duplicado

---

## 5. Checkout e planos

- [ ] Free → Plus: checkout Asaas abre, pagamento sandbox, plano atualiza
- [ ] Plus → Professional: upgrade com proration calculada corretamente
- [ ] Professional → Free: downgrade ao final do período (formulários excedentes pausados)
- [ ] Plano expirado: `/api/user/plan-features` reverte para free automaticamente
- [ ] Formulários pausados por downgrade aparecem com badge "pausado" no dashboard
- [ ] Unpause após upgrade: formulários despausam automaticamente

---

## 6. Segurança (smoke tests)

- [x] POST `/api/auth/login` com Origin atacante → `403 Forbidden` (validado 2026-05-04)
- [ ] POST `/api/responses` sem `form_id` → `400`
- [x] POST `/api/responses` com form não publicado → `404` (validado 2026-05-04)
- [ ] POST `/api/responses` com payload > 50KB → `413`
- [ ] POST `/api/responses` com honeypot `_hp_` preenchido → `201` fake (silent drop)
- [ ] GET `/api/forms` sem autenticação → `401 Não autorizado`
- [ ] PATCH `/api/forms/{id}` de form de outro usuário → `404` (RLS)
- [ ] Submissão com `<script>` em resposta → HTML removido, XSS não ocorre
- [ ] Webhook Asaas com HMAC inválido → `401`
- [ ] Webhook Asaas duplicado (mesmo `event_id`) → `200` sem reprocessar

---

## 7. Acessibilidade (builder)

- [ ] Todos os `<select>` no QuestionEditor têm `aria-label` ou `htmlFor` associado
- [ ] Toggle "Obrigatório" tem label conectada (`htmlFor`/`id`)
- [ ] Selects de lógica condicional têm `aria-label`
- [ ] Navegação por teclado no form player: Enter avança, Backspace/ArrowUp volta
- [ ] Player não trava em nenhum tipo de pergunta com teclado

---

## 8. Verificações finais de P3

- [ ] Logs de servidor não expõem PII (testar via Vercel logs: buscar por email/phone)
- [ ] Paginação de forms (`GET /api/forms?page=2`) retorna resultados estáveis (tiebreaker por `id`)
- [ ] Paginação de responses retorna estável (tiebreaker por `id`)
- [ ] UTM tracker: erro de JSON.parse aparece como `console.warn` (não silencioso)
- [ ] Strings em inglês eliminadas das respostas da API (testar com DevTools Network)

---

## Como executar

1. Deploy na Vercel de `main`.
2. Abrir `https://eidosform.com.br` em aba privada.
3. Marcar cada item conforme testa.
4. Se algum item falhar: abrir issue com label `regression` + detalhar steps to reproduce.
5. Bloquear merge para `main` até regressão resolvida.

---

**Critério de done:** todos os itens marcados ✅ sem pendências abertas.

---

## Status K1 (2026-05-04)

- ✅ Smoke tests automáticos via curl: 4 itens validados (CSRF block, signup body, /api/responses 404, headers nginx).
- ⚠️ Validação ponta-a-ponta com browser/auth/email/WhatsApp/checkout: pendente. Sidney precisa rodar manualmente em browser autenticado.
- ⚠️ Dependências externas para K1 completo: conta de teste no dashboard, número WhatsApp configurado, conta Asaas em sandbox.
