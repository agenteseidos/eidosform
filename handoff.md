## Handoff — Zéfa → Sidney — 2026-04-22 21:16 GMT-3

### Demanda
Mapear o bug de email duplicado no EidosForm (auditoria de features de venda).

### O que foi feito

Mapeamento completo das 3 libs de email e do bug de duplicação:

#### As 3 Libs de Email

| # | Arquivo | Propósito | Status |
|---|---------|-----------|--------|
| 1 | `lib/email.ts` | Notificação ao dono (system email) — busca email do perfil via Supabase REST | **REDUNDANTE** |
| 2 | `lib/notify.ts` | Notificação configurada pelo usuário (feature gate, email customizável) | **MANTER** |
| 3 | `lib/resend.ts` | Emails transacionais (plano ativado/cancelado, alerta de limite) | **MANTER** |

Todas as 3 usam a mesma API do Resend via `fetch` direto. Nenhuma usa SDK.

#### O Bug de Duplicação

No endpoint `POST /api/responses` (`app/api/responses/route.ts`, linhas ~284-310):

1. **Linha 297-298**: Importa e chama `sendNewResponseNotification` de `lib/email.ts` — envia email **sempre** ao email do perfil do dono (busca via Supabase REST). Não tem feature gate.
2. **Linha 304-310**: Chama `sendEmailNotification` de `lib/notify.ts` — envia email ao endereço configurado no formulário (`form.notify_email`), **somente se** `notify_email_enabled=true` E o plano permite `emailNotifications`.

**Resultado**: Quando o usuário configura notificação por email (notify_email = próprio email), recebe 2 emails por resposta:
- Um de `lib/email.ts` (sempre, para o email do perfil)
- Um de `lib/notify.ts` (quando feature habilitada, para o email configurado no form)

#### Todos os Pontos de Envio de Email

| Ponto | Lib | Gatilho | Feature Gate |
|-------|-----|---------|-------------|
| `app/api/responses/route.ts:297` | `lib/email.ts` | Nova resposta completa | Nenhum (sempre) |
| `app/api/responses/route.ts:305` | `lib/notify.ts` | Nova resposta completa | `notify_email_enabled` + plano |
| `app/api/webhooks/asaas/route.ts` | `lib/resend.ts` | Webhook Asaas | N/A (evento de pagamento) |
| `lib/plan-limits.ts` | `lib/resend.ts` | 80% do limite | N/A (alerta automático) |

### Recomendação

**Manter**: `lib/resend.ts` (transacionais) + `lib/notify.ts` (notificação por resposta, feature-gated)

**Remover**: `lib/email.ts` — é uma duplicação não-gated de funcionalidade que `lib/notify.ts` já cobre com feature gate e email customizável.

**Passos exatos para eliminar duplicação**:
1. Remover a chamada em `app/api/responses/route.ts` linhas 295-298 (bloco `// Email de notificação (system email — always allowed)`)
2. Remover o arquivo `lib/email.ts`
3. (Opcional) Garantir que a primeira resposta de um form ative automaticamente `notify_email_enabled=true` com o email do perfil, se ainda não estiver configurado — assim usuários novos não ficam sem notificação

### Arquivos alterados
- `handoff.md` — atualizado

### Pendências
- Implementar a remoção (não feito nesta auditoria)

### Próximo passo
- Sidney aprovar e implementar os 3 passos acima
