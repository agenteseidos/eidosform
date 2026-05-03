# Relatório de Correções — Auditoria EidosForm

> Gerado em 2026-05-02. Atualizado continuamente por etapa.

---

## Etapa 4 — Endurecimento do signup (email enumeration)

**Status:** ✅ Concluída em 2026-05-02 21:40
**Achados endereçados:** F2-E5-01, P0-1 (Fase 1)
**Arquivos alterados:**
- `app/api/auth/signup/route.ts`
- `app/(auth)/register/page.tsx`

**O que foi feito:**
- Removido campo `autoConfirmed` do body de retorno do POST `/api/auth/signup`. Antes, novos cadastros retornavam `{ success: true, autoConfirmed: false/true, message: ... }` enquanto emails duplicados retornavam `{ success: true, message: ... }` — a presença/ausência do campo permitia enumerar se o email já estava cadastrado.
- Agora ambos os casos retornam exatamente `{ success: true, message: 'Verifique seu email para confirmar.' }`.
- Atualizado `register/page.tsx` para sempre redirecionar para `/verify-email` ao invés de bifurcar em `/dashboard` quando `autoConfirmed` era `true`.

**Validação:** Body idêntico para email novo e email já registrado (201 em ambos os casos, sem campo diferenciador).

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 5 — Login: bloquear email não-confirmado + slimmar response

**Status:** ✅ Concluída em 2026-05-02 (commit 66fc225)
**Achados endereçados:** P0-3 (Fase 1), F2-E2-01
**Arquivos alterados:**
- `app/api/auth/login/route.ts`
- `app/(auth)/login/page.tsx`

**O que foi feito:**
- Após `signInWithPassword` com sucesso, o endpoint checa `data.user?.email_confirmed_at`. Se nulo, faz `signOut()` imediato e retorna `403 { error: 'Confirme seu email antes de entrar.', code: 'EMAIL_NOT_CONFIRMED' }`.
- Response de sucesso reduzido a `{ success: true, redirectTo: '/forms' }` — objeto `user` completo não é mais exposto.
- Frontend (`login/page.tsx`): ao receber `code: 'EMAIL_NOT_CONFIRMED'`, mostra toast explicativo e dispara `POST /api/auth/resend-verification` (fire-and-forget) para reenviar o link.

**Validação:** login com email não confirmado retorna 403; login bem-sucedido retorna 200 apenas com `success + redirectTo`.

**Pendências dentro da etapa:** nenhuma.

---

## Etapa 6 — Remover CSRF skip de `/api/auth/*`

**Status:** ✅ Concluída em 2026-05-02 (commit 66fc225)
**Achados endereçados:** F2-E5-02, P2-6 (Fase 1)
**Arquivos alterados:**
- `middleware.ts`

**O que foi feito:**
- `publicWritePaths` foi reduzido a `['/api/responses']`. Rotas `/api/auth/*` não têm mais bypass de CSRF.
- Qualquer POST para `/api/auth/login`, `/api/auth/signup` etc. com `Origin` fora de `ALLOWED_ORIGINS` recebe `403 { error: 'Forbidden' }`.
- Domínios customizados verificados (`isVerifiedCustomDomain`) mantêm bypass apenas para `/api/responses` (necessário para embeds de forms).

**Validação:** `curl -X POST -H 'Origin: https://attacker.example.com' .../api/auth/login` retorna `403`.

**Pendências dentro da etapa:** nenhuma.
