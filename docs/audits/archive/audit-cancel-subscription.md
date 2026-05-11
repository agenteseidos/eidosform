# Auditoria: Cancelar Assinatura (commit 8e54ee4)

## Resumo
3 arquivos analisados. 5 bugs encontrados (0 P0, 1 P1, 3 P2, 1 P3).

## Bugs

### P1 — Estado da UI não atualiza após cancelamento
**Arquivo:** `components/settings/account-actions.tsx`
**Problema:** Após cancelar com sucesso, o componente mostra toast mas não atualiza a UI. O botão "Cancelar assinatura" continua visível e funcional. Não há `router.refresh()` ou `revalidatePath()`.
**Impacto:** Usuário pode clicar novamente e tentar cancelar uma assinatura já cancelada no Asaas.
**Fix:** Chamar `router.refresh()` após o sucesso, ou usar `revalidatePath('/settings')` no server action, ou recarregar a página.

### P2 — `handleDeleteAccount` não deleta a conta
**Arquivo:** `components/settings/account-actions.tsx`
**Problema:** A função `handleDeleteAccount` faz `signOut()` e redireciona para `/login`. Não deleta nada. O texto diz "Remove todos os dados permanentemente" mas a ação é apenas logout.
**Impacto:** Engano severo de UX — usuário acha que deletou a conta mas apenas deslogou.
**Fix:** Implementar endpoint de deleção real ou corrigir o label para "Sair da conta".

### P2 — Condição de exibição usa `planKey` em vez de `plan_status`
**Arquivo:** `components/settings/account-actions.tsx`
**Problema:** O botão de cancelar aparece quando `planKey !== 'free'`. Mas se a assinatura foi cancelada (status `canceling`), o plano ainda não é `free` — o botão continua aparecendo.
**Impacto:** Usuário vê "Cancelar assinatura" mesmo quando já cancelou.
**Fix:** Também checar `plan_status !== 'canceling' && plan_status !== 'cancelled'`.

### P2 — Resposta 502 com `plan_status: 'canceling'` pode causar inconsistência
**Arquivo:** `app/api/subscription/cancel/route.ts`
**Problema:** Se o Asaas cancela com sucesso mas o `update` do Supabase falha, retorna 500 com mensagem confusa ("Assinatura cancelada, mas erro ao atualizar perfil"). O Asaas já cancelou, o banco não reflete isso. Sem mecanismo de retry.
**Impacto:** Estado inconsistente entre Asaas e banco local. O webhook eventualmente corrige, mas a UX é ruim.
**Fix:** Idealmente usar transação ou pelo menos logar o erro para retry manual. Considerar retornar sucesso para o usuário e corrigir async.

### P3 — XSS potencial em `toast.error(data.error)`
**Arquivo:** `components/settings/account-actions.tsx`
**Problema:** `data.error` vem do servidor e é inserido via `toast.error()` do Sonner. O Sonner escapa HTML por padrão, então na prática é seguro. Mas o padrão de confiar em dados do server sem sanitização explícita é frágil.
**Impacto:** Baixo — Sonner escapa. Apenas boas práticas.
**Fix:** Não urgente, mas documentar que error messages do server são trusted input.

## Pontos Positivos
- ✅ Autenticação via `supabase.auth.getUser()` correta
- ✅ Verificação de `asaas_subscription_id` antes de chamar Asaas
- ✅ Tratamento de erros do Asaas com catch e resposta 502
- ✅ Modal de confirmação claro com data de expiração
- ✅ Loading state (`canceling`) impede cliques duplos no modal
- ✅ Mensagens em pt-BR consistentes
- ✅ Uso de shadcn Dialog e Sonner, consistente com o restante
- ✅ `plan_status: 'canceling'` é o valor correto (webhook trata `cancelled` depois)
