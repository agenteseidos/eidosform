## Handoff — Toin (correções dashboard P0+P1+P2) — 2026-04-22 20:45 GMT-3

### Demanda
Corrigir todos os P0, P1 e P2 do dashboard do EidosForm identificados na auditoria da Zéfa.

### O que foi feito

**P0 (3/3 corrigidos):**
1. Botão "Voltar" em Respostas → corrigido de `/billing` para `/forms`
2. Botão "Voltar" em Billing → corrigido de `/billing` (loop) para `/forms`
3. Botões "Cancelar assinatura" e "Deletar conta" nas Settings → implementados:
   - Cancelar assinatura: link para `/billing` (só aparece para planos pagos)
   - Deletar conta: confirmation dialog + signOut + redirect para login
   - Texto "continuará no plano Free" agora só aparece para planos pagos (resolve P1-5 também)

**P1 (5/5 corrigidos):**
4. Ciclo de reset dinâmico (calcula próximo dia 1 do mês)
5. Perfil salva nome tanto no auth quanto na tabela `profiles`
6. Paginação na tabela de respostas (20 por página, controles Anterior/Próxima)
7. Sidebar de pastas no mobile: dialog drawer com navegação por pastas + botão criar pasta
8. Texto "continuará no plano Free" condicional (só para planos pagos)

**P2 (2/2 corrigidos):**
9. Templates duplicado na empty state → removido duplicata (mantido só no header)
10. Slug visível no FormCard (font-mono, abaixo da data de atualização)

### Novo arquivo criado
- `components/settings/account-actions.tsx` — client component para ações de conta (cancelar/deletar)

### Validação
- TypeScript: build limpo (0 erros)
- Push: `fc610c8` na main

### Pendências
- Nenhuma

### Próximo passo
- Sidney validar visualmente em staging/produção

### Arquivos alterados
- `app/(dashboard)/billing/page.tsx` — P0-2, P1-1
- `app/(dashboard)/forms/page.tsx` — P2-7
- `app/(dashboard)/settings/page.tsx` — P0-3, P1-5
- `components/responses/responses-dashboard.tsx` — P0-1, P1-3
- `components/dashboard/dashboard-shell.tsx` — P1-4
- `components/dashboard/form-card.tsx` — P2-6
- `components/settings/profile-settings.tsx` — P1-2
- `components/settings/account-actions.tsx` — NOVO (P0-3, P1-5)
