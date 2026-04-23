## Handoff — Zéfa → Sidney — 2026-04-22 22:27 GMT-3

### Demanda
Revalidar os 4 fixes do commit `0abfb2a` (PDF export + white-label).

### O que foi feito
Revalidação completa dos 4 fixes. Todos limpos, zero P0/P1/P2.

#### ✅ P1 — PDF footer sem branding para Plus/Professional
- `lib/export-pdf.ts` — `hideBranding` param omite "EidosForm" do footer quando true
- `app/api/forms/[id]/export/route.ts` — passa `hideBranding = !!PLANS[userPlan]?.pdfExport`

#### ✅ P2 — PDF dropdown escondido para planos sem pdfExport
- `components/responses/responses-dashboard.tsx` — PDF DropdownMenuItem condicionado a `PLANS[userPlan as PlanName]?.pdfExport`

#### ✅ P2 — generateMetadata usa Supabase direto (sem self-fetch)
- `app/f/[slug]/page.tsx` — `fetchOwnerPlan()` helper consulta Supabase diretamente, zero self-fetch restante

#### ✅ P3 — Type casts limpos
- `app/f/[slug]/page.tsx` — zero ocorrências de `as unknown as`

### Validação
- TypeScript: `tsc --noEmit` passa limpo ✅
- Verificação grep: todos os 4 fixes presentes no código atual ✅

### Veredito
**Zero P0/P1/P2.** Todos os fixes estão corretos e intactos.

### Arquivos verificados
- `lib/export-pdf.ts`
- `app/api/forms/[id]/export/route.ts`
- `components/responses/responses-dashboard.tsx`
- `app/f/[slug]/page.tsx`

### Pendências
- Nenhuma

### Próximo passo
- Deploy quando quiser
