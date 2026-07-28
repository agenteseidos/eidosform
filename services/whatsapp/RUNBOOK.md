# RUNBOOK — Notificação de lead por WhatsApp (VPS)

> Serviço que avisa o dono do formulário quando entra lead. **NÃO é a Elen** (atendimento,
> nº 5583999378937, Cloud API). Este aqui é o nº **5583996966457**, cliente não-oficial.
> Ficha completa com histórico dos incidentes: `shared-memory/operacional/notificacao-lead-whatsapp-eidosform.md`.

## Arquitetura (2 motores, 1 chave)

```
app (Vercel) ──► PM2 eidosform-whatsapp :3457 (server.js)
                   ├─ transporte PRIMÁRIO ─► wuzapi (systemd, 127.0.0.1:8080, WebSocket persistente)
                   ├─ transporte RESERVA ──► wacli  (CLI; desliga-religa a conexão a CADA envio)
                   ├─ outbox.json  ← fila de reenvio (falha NÃO descarta; backoff 1min→1h, 24 tentativas)
                   └─ ops-alert.js ← e-mail (Resend, 2 destinatários) p/ fallback, 3 falhas seguidas,
                                     carta morta e volume alto (1×/dia)
```

- Config em `.env`: `WHATSAPP_TRANSPORT=wuzapi` + `WHATSAPP_TRANSPORT_FALLBACK=wacli`.
- **Rollback** = trocar `WHATSAPP_TRANSPORT` + `pm2 restart eidosform-whatsapp --update-env`.
- Reserva só entra em falha **PRE_FLIGHT** (nada saiu). IN_FLIGHT/timeout nunca aciona reserva
  (mensagem enviada não desenvia; a idempotência NÃO protege duplicata entre motores).
- Resposta `202 {queued:true}` = na fila de reenvio, **não é sucesso nem falha** — o app e o cron
  de abandonado tratam esse estado explicitamente (não inventar messageId!).

## As 3 armadilhas que já causaram incidente (não reaprender do zero)

1. **JID brasileiro = 12 dígitos** (`558396966457`, sem o 9). O de 13 NÃO existe; enviar pra ele
   dá erro 463 (ou pior, ACK silencioso). Ordem certa em `brazilianPhoneCandidates` (transport.js),
   compartilhada pelos dois motores — motor novo NÃO pode declarar ordem própria.
2. **`authenticated=true` ≠ envio funcionando.** Em 27/07 ficou true por 9h com TODO envio falhando.
   O alarme que vale é o de falhas consecutivas (`failures` no /status), não o selo da sessão.
3. **"enviado" ≠ LEGÍVEL.** A sessão de criptografia apodrece POR APARELHO do destinatário
   (celular 27/07, web 28/07). Servidor dá ACK, log diz success, painel verde — e o humano vê
   "Aguardando mensagem". Não existe detecção automática; ver cirurgia abaixo.

## Cirurgia de sessão podre (validada 2×) — sintoma: "Aguardando mensagem" em UM aparelho

O aparelho afetado pede reenvio; o wuzapi só atende se a mensagem estiver no cache EM MEMÓRIA
(morre no restart). Pedido não atendido = sessão desincronizada PARA SEMPRE. Conserto (~2min, sem QR):

```bash
systemctl stop eidosform-wuzapi.service
cp /var/lib/wuzapi/dbdata/main.db /root/wuzapi-main.db.bak-$(date +%d%m)
# 1) achar o LID do destinatário (sessões são por LID, NÃO por telefone!):
sqlite3 /var/lib/wuzapi/dbdata/main.db "SELECT lid,pn FROM whatsmeow_lid_map WHERE pn LIKE '%<fone>%';"
# 2) device: _1:0 = celular · _1:47+ = web/desktop. Apagar SÓ o quebrado:
sqlite3 /var/lib/wuzapi/dbdata/main.db "DELETE FROM whatsmeow_sessions WHERE their_id='<LID>_1:<dev>';
                                        DELETE FROM whatsmeow_identity_keys WHERE their_id='<LID>_1:<dev>';"
systemctl start eidosform-wuzapi.service
# próximo envio renegocia a sessão sozinho. Pareamento e demais aparelhos ficam intactos.
```

## Regras operacionais

- **NÃO reiniciar o wuzapi à toa.** Cada restart zera o cache de reenvio = janela de envenenamento.
- **Após QUALQUER restart/disconnect do wuzapi:** canário pro número pessoal e confirmar leitura
  no **WEB PRIMEIRO** (abrir o celular repassa o conteúdo pro web e mascara o teste), depois celular.
- **Validar mudança de transporte** = enviar pro DESTINO REAL + confirmação humana de leitura.
  Mensagem para o próprio número NÃO passa pelo mesmo caminho de criptografia — não vale como teste.
- **Botão "Desconectar" do painel faz LOGOUT** (desfaz o vínculo, exige QR novo). Para testar queda
  use `POST /session/disconnect` no wuzapi (mantém o pareamento).
- Os 2 motores usam a MESMA linha: reserva protege contra motor quebrado, NÃO contra banimento.

## Diagnóstico rápido

```bash
KEY=$(grep '^WHATSAPP_API_KEY=' .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:3457/api/whatsapp/status | python3 -m json.tool
# olhar: activeTransport · fallbackActive · outbox.pending/dead · failures.consecutive · daily
tail -50 server.log                      # [send] / [outbox] / [fallback] / [falha]
systemctl status eidosform-wuzapi        # painel: eidosform.com.br/admin/whatsapp
```

## Arquivos de estado (todos no .gitignore)

`sent-keys.json` idempotência (96h) · `outbox.json` fila de reenvio · `transport-metrics.json`
contadores por dia/motor + incidentes · `status.json` snapshot p/ healthcheck ·
`/var/lib/wuzapi/dbdata/` sessões de criptografia do wuzapi (backups em `/root/wuzapi-main.db.bak-*`).
