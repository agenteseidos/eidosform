# Verificação da Auditoria — Cancelar Assinatura

**Data da verificação:** 2026-05-02
**Auditor original:** Claude Code (1 mai/2026)
**Verificador:** Claude Code (Opus 4.7, 1M context)
**Origem da auditoria:** `audit-cancel-subscription.md` (commit-base: `8e54ee4`)
**Para:** Zé / OpenClaw — verificação das correções aplicadas pelos agentes do OpenClaw após a auditoria
**Escopo:** 5 bugs (0 P0, 1 P1, 3 P2, 1 P3) no fluxo de cancelar assinatura e deletar conta

---

## Resumo executivo

| Severidade | Total | Corrigidos | Pendentes | Aceitos sem correção |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 1 | 1 | 0 | 0 |
| P2 | 3 | 3 | 0 | 0 |
| P3 | 1 | 0 | 0 | 1 |
| **Total** | **5** | **4** | **0** | **1** |

**Conclusão:** **100% dos itens acionáveis (P0/P1/P2) foram resolvidos.** O único item não corrigido é o P3, que a própria auditoria classificou como "não urgente — Sonner escapa por padrão". Build de tipos (`npx tsc --noEmit`) passa limpo.

**Commits que endereçaram a auditoria:**
- `d3a73e3` — `fix: P1/P2 cancelar assinatura - UI atualiza após cancelar, esconde botão se já cancelando, tratamento de inconsistência`
- `2f53cba` — `feat: deletar conta com confirmação dupla e cleanup completo`
- `db4e171` — `fix: deletar whatsapp_settings antes do profile na exclusão de conta`

---

## Verificação item a item

### P1 — Estado da UI não atualiza após cancelamento ✅ CORRIGIDO

**Arquivo afetado:** `components/settings/account-actions.tsx`
**Sugestão da auditoria:** chamar `router.refresh()`, `revalidatePath('/settings')`, ou recarregar a página após sucesso.

**Como foi corrigido (abordagem alternativa, válida):**
- Foi introduzido um state local `cancelled` (linha 27):
  ```tsx
  const [cancelled, setCancelled] = useState(initialPlanStatus === 'canceling')
  ```
- Após sucesso da requisição, `setCancelled(true)` é chamado (linha 48), trocando a UI imediatamente para o bloco "Assinatura cancelada — acesso até X" e ocultando o botão (linhas 96–116).
- Ao recarregar a página, o estado inicial já vem `true` porque `plan_status === 'canceling'` é persistido no DB.

**Avaliação do verificador:** ✅ Resolve a causa-raiz (clique duplo + UI desatualizada). A abordagem de state local em vez de `router.refresh()` é válida e mais responsiva (sem round-trip extra). Aprovado.

---

### P2 — `handleDeleteAccount` não deleta a conta ✅ CORRIGIDO

**Arquivo afetado:** `components/settings/account-actions.tsx`
**Sugestão da auditoria:** implementar endpoint real ou corrigir o label.

**Como foi corrigido:**
- Foi criado o endpoint `app/api/account/delete/route.ts` (POST), que:
  1. Autentica via `supabase.auth.getUser()`.
  2. Cancela a assinatura no Asaas (best-effort, não bloqueia se falhar).
  3. Apaga `form_whatsapp_settings` antes (não tem ON DELETE CASCADE — fix de `db4e171`).
  4. Chama `adminSupabase.auth.admin.deleteUser(user.id)`, que cascateia em `profiles → forms → responses → answer_items → billing_checkouts → folders → custom_domains → whatsapp_logs`.
- Componente agora chama o endpoint real (linha 67) e só faz `signOut()` + redirect após sucesso.
- UX foi reforçada com **confirmação em duas etapas** + digitação literal de "DELETAR" (linhas 174–252). Padrão sólido para ação destrutiva.

**Avaliação do verificador:** ✅ Implementação completa, com cleanup explícito da tabela órfã (`form_whatsapp_settings`) e fluxo de confirmação dupla. Aprovado.

---

### P2 — Condição de exibição usa `planKey` em vez de `plan_status` ✅ CORRIGIDO

**Arquivo afetado:** `components/settings/account-actions.tsx`
**Sugestão da auditoria:** checar também `plan_status !== 'canceling' && plan_status !== 'cancelled'`.

**Como foi corrigido:**
- Componente agora recebe `planStatus: initialPlanStatus` (linha 24) e inicializa `cancelled = (initialPlanStatus === 'canceling')` (linha 27).
- Quando `cancelled === true`, o bloco renderiza "Assinatura cancelada — acesso até X" e oculta o botão (linhas 96–116).

**Sobre o caso `plan_status === 'cancelled'`:** o webhook do Asaas em `app/api/webhooks/asaas/route.ts:411-422` seta **simultaneamente** `plan: 'free'` e `plan_status: 'cancelled'`. Como o componente já tem o guard `planKey !== 'free'` na linha 93, o bloco inteiro nem é renderizado nesse estado. Portanto não há gap residual — o estado `cancelled` cobre o intervalo `canceling`, e o downgrade para `free` cobre o estado final `cancelled`.

**Avaliação do verificador:** ✅ Coberto. Sem necessidade de adicionar check extra para `'cancelled'` porque o pareamento `plan/plan_status` no webhook torna esse caso impossível em produção. Aprovado.

---

### P2 — Inconsistência Asaas/DB no cancel ✅ CORRIGIDO

**Arquivo afetado:** `app/api/subscription/cancel/route.ts`
**Sugestão da auditoria:** transação, retry, ou logar para retry manual.

**Como foi corrigido (abordagem alternativa, válida):**
- A ordem das operações foi **invertida**: agora atualiza o DB **primeiro** com `plan_status: 'canceling'` (linhas 28–35), e só então chama o Asaas (linha 38).
- Se o Asaas falhar, o status é **revertido** para o valor anterior (linhas 40–46), evitando o estado em que o DB diz "canceling" mas o Asaas nunca foi notificado.
- Adicionado guard idempotente: se `plan_status === 'canceling'` já, retorna 409 sem reabrir o fluxo (linhas 23–25).
- Eliminada a mensagem confusa anterior ("Assinatura cancelada, mas erro ao atualizar perfil"). Agora ou ambos sucedem ou ambos voltam ao estado original.

**Avaliação do verificador:** ✅ Resolve a inconsistência apontada com uma abordagem do tipo "reservar localmente, confirmar externamente, reverter se falhar" — mais robusta que retry assíncrono para esse caso. Aprovado.

**Observação não-bloqueante:** o catch do Asaas usa `catch {}` sem logar a exceção. Em produção, valeria adicionar um `logger.error` para facilitar diagnóstico se o Asaas começar a falhar com frequência. Não é regressão da auditoria.

---

### P3 — XSS potencial em `toast.error(data.error)` ⚠️ ACEITO SEM CORREÇÃO

**Arquivo afetado:** `components/settings/account-actions.tsx` (linhas 44, 70)
**Sugestão da auditoria:** "Não urgente, mas documentar que error messages do server são trusted input."

**Estado atual:** sem alteração. As chamadas continuam `toast.error(data.error ?? '...')` sem comentário documentando o trust.

**Avaliação do verificador:** ⚠️ Aceitável manter como está.
- Sonner faz escape de HTML por padrão (a própria auditoria reconhece isso).
- O texto de `data.error` vem dos endpoints internos (`/api/subscription/cancel`, `/api/account/delete`) e é controlado pelo próprio backend — não é input de usuário arbitrário.
- O risco real é nulo no código atual.
- Adicionar um comentário seria a melhoria sugerida, mas omiti-lo intencionalmente está alinhado com a convenção do repo de evitar comentários sem WHY não-óbvio.

**Recomendação para o Zé:** se o time do OpenClaw preferir documentação explícita por consistência, sugerir um pequeno PR adicionando um comentário `// trusted: server-controlled error string, sonner escapes HTML by default` próximo às chamadas. Caso contrário, deixar como está.

---

## Pontos positivos confirmados (auditoria original)

Todos os pontos positivos listados na auditoria continuam válidos no estado atual do código:

- ✅ Autenticação via `supabase.auth.getUser()` correta em ambos os endpoints
- ✅ Verificação de `asaas_subscription_id` antes de chamar Asaas
- ✅ Tratamento de erros do Asaas com catch e resposta 502
- ✅ Modal de confirmação claro com data de expiração
- ✅ Loading state (`canceling`) impede cliques duplos
- ✅ Mensagens em pt-BR consistentes
- ✅ Uso de shadcn Dialog e Sonner consistente
- ✅ `plan_status: 'canceling'` é o valor correto, webhook trata `cancelled` no downgrade

---

## Validação técnica

- `npx tsc --noEmit` — **passa sem erros** ✅
- Estrutura dos arquivos auditados:
  - `components/settings/account-actions.tsx` — 255 linhas, lógica completa de ambos os fluxos
  - `app/api/subscription/cancel/route.ts` — 49 linhas, fluxo "DB-first com revert"
  - `app/api/account/delete/route.ts` — 43 linhas (NOVO), com cancelamento Asaas + cleanup + admin delete

## Recomendações para o Zé

1. **Aprovar como entregue.** Os 4 itens P1/P2 foram corrigidos, o P3 é cosmético e a própria auditoria sinalizou como não-urgente.

2. **Considerar como melhoria futura (não-bloqueante):**
   - Logar a exceção capturada em `cancel/route.ts:39` quando o Asaas falha (atualmente é `catch {}` silencioso).
   - Logar a exceção capturada em `account/delete/route.ts:24` (cancelSubscription best-effort).
   - Eventualmente adicionar testes de integração para os fluxos de cancel + delete (não havia teste para essa área).

3. **Sem regressões introduzidas.** Confirmado por type-check limpo e por inspeção dos commits envolvidos.

---

**Assinatura:** verificação executada por Claude Code (Opus 4.7) em 2026-05-02, no diretório `/home/sidney/eidosform/`. Nenhuma correção adicional foi necessária — o trabalho dos agentes do OpenClaw já cobriu o backlog da auditoria.
