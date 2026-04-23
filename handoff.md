## Handoff — Toin → Sidney — 2026-04-22 22:14 GMT-3

### Demanda
Implementar exportação PDF no EidosForm.

### O que foi feito
1. **`lib/export-pdf.ts`** — Novo módulo que gera PDF com jsPDF + jspdf-autotable:
   - Título do formulário no topo com data de exportação
   - Tabela com todas as respostas (landscape A4, fonte compacta)
   - Header com cor emerald-500, linhas alternadas
   - Paginação automática com rodapé (número de página + branding EidosForm)
2. **`app/api/forms/[id]/export/route.ts`** — Endpoint estendido com `?format=pdf`:
   - Gate por plano: PDF só disponível para Plus e Professional
   - Content-Type: `application/pdf`
3. **`lib/plan-limits.ts`** — Adicionado campo `pdfExport: boolean` em `PlanConfig`:
   - free/starter: `false`
   - plus/professional: `true`
4. **`components/responses/responses-dashboard.tsx`** — Dropdown de exportação agora tem 3 opções:
   - CSV / Excel (.xlsx) / PDF
5. **Dependências instaladas:** `jspdf` + `jspdf-autotable`
6. **TypeScript** — Build passa sem erros
7. **Commit & push** — `03e1f93` em `main`

### Arquivos alterados
- `lib/export-pdf.ts` (novo)
- `lib/plan-limits.ts` (campo pdfExport)
- `app/api/forms/[id]/export/route.ts` (suporte PDF + gate por plano)
- `components/responses/responses-dashboard.tsx` (opção PDF no dropdown)
- `package.json` + `package-lock.json` (jspdf, jspdf-autotable)

### Pendências
- Nenhuma

### Próximo passo
- Sidney testa a exportação PDF no dashboard
- Considerar adicionar "Exportação PDF" nos features dos planos Plus/Professional no pricing/billing
