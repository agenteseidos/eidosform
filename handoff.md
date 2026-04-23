## Handoff — Zéfa (auditoria venda/conversão) — 2026-04-22 20:43 GMT-3

### Demanda
Auditoria focada em features de venda e conversão do EidosForm.

### O que foi feito
Mapeamento completo de 6 áreas: pixels/tracking, webhooks/integrações, billing/checkout, distribuição/white-label, exportação, e features gerais. Identificados gaps entre oferta e produto real, bugs com impacto comercial, e classificação por impacto em venda.

### Resultado
Relatório completo em `docs/audit-venda-conversao.md`.

**Destaques:**
- 🔴 **3 gaps críticos:** Embed/iframe (inexistente), Multi-user Pro (vendido, não implementado), White-label parcial (só remove watermark)
- 🟠 **5 gaps altos:** Exportação PDF/Excel, branding de conta, PIX/Boleto, Meta CAPI, Webhook HMAC+logs
- 🐛 **7 bugs com impacto comercial:** emails duplicados (P1), feature gating client-side, data do ciclo hardcoded, UTM storage bug, TikTok duplicado, código morto
- Roadmap sugerido em 4 sprints priorizados

### Arquivos criados/alterados
- `docs/audit-venda-conversao.md` (novo — relatório completo)

### Pendências
- Nenhuma bloqueante. Recomenda-se seguir roadmap do relatório.

### Próximo passo
- Sidney revisar relatório e decidir priorização do Sprint 1
- Embed snippet é o quick-win de maior impacto
- Decisão sobre multi-user Pro: implementar ou remover da oferta
