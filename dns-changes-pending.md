# Mudanças DNS Pendentes (Bloco I — Etapas I1 e I2)

> **Status:** ⚠️ Pendente — exige ação manual de Sidney no painel DNS de `eidosform.com.br`
> **Branch:** `fix/auditoria-fechamento`
> **Data:** 2026-05-04

## Estado atual (verificado via `dig`)

```
$ dig +short MX eidosform.com.br
0 eidosform.com.br.

$ dig +short TXT _dmarc.eidosform.com.br
"v=DMARC1; p=none; rua=mailto:agenteseidos@gmail.com"
```

## Mudanças exigidas

### Etapa I1 — Null MX (RFC 7505)

**Onde:** painel DNS de `eidosform.com.br` (Registro.br ou provedor atual).

**Trocar:**
```
MX  eidosform.com.br.  →  0 eidosform.com.br.
```
**Por:**
```
MX  eidosform.com.br.  →  0 .
```

**Validação após propagação (~1h):**
```bash
dig +short MX eidosform.com.br
# Esperado: 0 .
```

---

### Etapa I2 — DMARC `rua` em inbox dedicada

**Onde:** mesmo painel DNS, registro TXT em `_dmarc.eidosform.com.br`.

**Trocar valor de:**
```
v=DMARC1; p=none; rua=mailto:agenteseidos@gmail.com
```
**Por:**
```
v=DMARC1; p=none; rua=mailto:dmarc-reports@institutoeidos.com.br
```

> Pré-requisito: confirmar que `dmarc-reports@institutoeidos.com.br` existe (criar caso contrário no Google Workspace do Instituto Eidos). Se preferir outro endereço institucional (não-Gmail-pessoal), substituir.

**Validação após propagação:**
```bash
dig +short TXT _dmarc.eidosform.com.br
# Esperado: "v=DMARC1; p=none; rua=mailto:<endereço-dedicado>"
```

---

## Lembrete pós-mudança

Em ~14 dias após I2, evoluir DMARC para `p=quarantine` se relatórios em `dmarc-reports@institutoeidos.com.br` não acusarem falsos positivos. Em ~30 dias, evoluir para `p=reject`.

**Após executar:** marcar I1 e I2 como ✅ no `relatorio-correcoes-auditoria.md` (Etapa K3) e remover este arquivo.
