# Status do Bloco I — DNS

> **Branch:** `fix/auditoria-fechamento`
> **Última atualização:** 2026-05-04

## Etapa I1 — MX do apex

**Status:** ⏳ Em propagação (Sidney aplicou em 2026-05-04)

**Decisão técnica:** o painel DNS do registrador não aceitou destino `.` literal (null MX da RFC 7505). Adotada solução equivalente: **excluir** o registro MX do apex inteiro. Servidores tratam ausência de MX como "domínio não recebe email", mesmo efeito prático do null MX.

**Validar após ~1h de propagação:**
```bash
dig +short MX eidosform.com.br
# Esperado: vazio (sem retorno)

dig +short MX send.eidosform.com.br
# Esperado: 10 feedback-smtp.sa-east-1.amazonses.com.   (não tocar — Resend)
```

---

## Etapa I2 — DMARC `rua`

**Status:** ✅ Aceito por decisão de produto em 2026-05-04

**Decisão:** manter `rua=mailto:agenteseidos@gmail.com`. A inbox é monitorada pelo agente Zé (OpenClaw), que processa relatórios DMARC automaticamente e dispara alertas relevantes ao Sidney via WhatsApp/Telegram. Não é uma inbox "pessoal solta" — é uma inbox de operação assistida por agente.

**Risco residual aceitável:** relatórios DMARC contêm apenas metadados de envio (IPs, contagens, alinhamento SPF/DKIM). Sem dados de clientes ou conteúdo de mensagens.

---

## Lembrete pós-propagação I1

Em ~14 dias após I1 propagar, evoluir DMARC para `p=quarantine` se os relatórios não acusarem falsos positivos. Em ~30 dias, evoluir para `p=reject`. Esse próximo passo é parte da hardening progressiva do antifraude — não é parte deste plano.
