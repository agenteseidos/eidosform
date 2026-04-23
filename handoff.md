## Handoff — Zéfa → Sidney — 2026-04-22 22:21 GMT-3

### Demanda
Auditar 2 features implementadas pelo Toin: exportação PDF e white-label real.

### O que foi feito
Auditoria completa dos commits `03e1f93` (PDF export) e `888131d` (white-label).

### Bugs encontrados

#### P1 — PDF footer branding vaza em white-label
- **Arquivo:** `lib/export-pdf.ts`, linha `didDrawPage`
- **Problema:** Footer do PDF sempre imprime "EidosForm", mesmo para usuários Plus/Professional que pagam por white-label. Contradiz a feature de white-label.
- **Fix:** Receber um parâmetro `hideBranding` no `buildPdfExport()` e condicionar o texto do footer.

#### P2 — PDF aparece no dropdown para usuários Starter
- **Arquivo:** `components/responses/responses-dashboard.tsx`, linhas ~579-582
- **Problema:** O item "PDF" aparece para todos os planos acima de Free (inclusive Starter), mas o endpoint retorna 403. Usuário clica e recebe erro.
- **Fix:** Condicionar a `<DropdownMenuItem>` do PDF com `{PLANS[userPlan as PlanName]?.pdfExport && (...)}`

#### P2 — generateMetadata faz fetch interno para pegar plano do dono
- **Arquivo:** `app/f/[slug]/page.tsx`, `generateMetadata`
- **Problema:** Usa `fetch()` para `/api/forms/${form.id}/plan` dentro do metadata generator. Em produção isso gera uma chamada HTTP interna (self-request) a cada renderização de OG tag. Funciona, mas é ineficiente e frágil — se o APP_URL não bater, falha silenciosamente.
- **Impacto:** Baixo (fallback para EidosForm branding), mas pode ser otimizado chamando o Supabase diretamente como `fetchPublishedForm` já faz.

#### P3 — Type cast feio em hide_branding
- **Arquivo:** `app/f/[slug]/page.tsx`, linha `form.hide_branding = true as unknown as typeof form.hide_branding`
- **Problema:** Cast feio, mas funcional. O tipo provavelmente precisa ser ajustado no schema.

### Sem bugs
- Endpoint de exportação com gating correto por plano
- `lib/export-pdf.ts` — lógica sólida, trata arrays/booleans/objects, layout limpo
- `lib/plan-limits.ts` — pdfExport configurado corretamente (Plus e Professional)
- White-label no `FormPage` (force hide_branding) — implementação correta
- OG tags — lógica de siteName condicional funciona

### Arquivos auditados
- `lib/export-pdf.ts` (novo)
- `lib/plan-limits.ts` (alterado)
- `app/api/forms/[id]/export/route.ts` (alterado)
- `components/responses/responses-dashboard.tsx` (alterado)
- `app/f/[slug]/page.tsx` (alterado)
- `app/api/forms/[id]/plan/route.ts` (existente, consultado)

### Pendências
- Corrigir P1 (PDF branding leak)
- Corrigir P2 (PDF dropdown para Starter)
- Opcional: otimizar P2 do metadata fetch

### Próximo passo
- Sidney decide prioridade dos fixes
