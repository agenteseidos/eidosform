# Monitor do WhatsApp (notificação de lead)

Healthcheck do serviço `eidosform-whatsapp` (wacli + Fastify :3457, atrás de
`wpp.eidosform.com.br`). O disparo de notificação é fire-and-forget: sem monitor,
uma queda de sessão passa despercebida (foi assim que a feature morreu antes).

## Instalar na VPS
```bash
sudo cp eidosform-wpp-hc.service eidosform-wpp-hc.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eidosform-wpp-hc.timer
```

## O que faz (a cada 5 min)
- `/health` fora OU `status.json` velho (>45s) → `pm2 restart eidosform-whatsapp` + e-mail.
- `authenticated=false` → e-mail com instrução de reparear (restart não resolve; precisa QR).
- Recuperação → e-mail "voltou ao ar".

Canal de alerta: e-mail via **Resend** (`RESEND_API_KEY` do `.env.production.local`),
independente da própria sessão WhatsApp monitorada. Destino: `ADMIN_ALERT_EMAIL`
(fallback `sidney@institutoeidos.com.br`). Dedup: 1 alerta por queda, re-alerta a cada 6h.
Estado em `/run/eidosform-wpp-hc/`.

## Verificar
```bash
systemctl list-timers eidosform-wpp-hc.timer
journalctl -t eidosform-wpp-hc -n 30
```
