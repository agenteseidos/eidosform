#!/bin/bash
# Healthcheck do serviço de notificação de lead por WhatsApp do EidosForm.
# (wacli + Fastify na porta 3457, PM2 `eidosform-whatsapp`, atrás de
# wpp.eidosform.com.br). Roda a cada 5min via systemd timer.
#
# O disparo de notificação é fire-and-forget: se a sessão do WhatsApp cair,
# nenhuma resposta de form gera erro visível e o dono não percebe (foi assim
# que a feature morreu antes). Este monitor fecha esse buraco.
#
# Sinal usado: services/whatsapp/status.json — o serviço reescreve esse arquivo
# a cada ~5s com {authenticated,connected,phoneNumber}. Ler o arquivo (em vez de
# invocar `wacli doctor` aqui) evita disputa de lock com o serviço e ainda prova,
# pela mtime, que o loop de refresh do serviço está vivo.
#
# Canal de alerta: e-mail via Resend (curl) — INDEPENDENTE da sessão WhatsApp que
# monitoramos (alertar pela mesma sessão que está caída não funciona).
#
# Estados detectados:
#   1) /health fora OU status.json velho  -> serviço travado -> pm2 restart + alerta
#   2) authenticated=false               -> sessão caiu -> alerta "reparear" (restart
#                                            não resolve: precisa escanear QR de novo)
#   3) recuperação                       -> alerta "voltou ao ar"
set -u

SVC_DIR=/home/sidney/eidosform/services/whatsapp
ENVFILE=/home/sidney/eidosform/.env.production.local
STATUS_FILE="$SVC_DIR/status.json"
HEALTH_URL=http://127.0.0.1:3457/health
STATEDIR=/run/eidosform-wpp-hc
STATUS_MAX_AGE=45          # status.json mais velho que isso = loop de refresh morto
REALERT_SECONDS=$((6*3600)) # re-alerta a cada 6h enquanto seguir caído
ALERT_TO=$(grep -oP '^ADMIN_ALERT_EMAIL=\K.*' "$ENVFILE" 2>/dev/null | tr -d '"'"'"'\r')
ALERT_TO=${ALERT_TO:-sidney@institutoeidos.com.br}
FROM='EidosForm Monitor <noreply@eidosform.com.br>'
RESEND_KEY=$(grep -oP '^RESEND_API_KEY=\K.*' "$ENVFILE" 2>/dev/null | tr -d '"'"'"'\r')

mkdir -p "$STATEDIR"

# ── envio de e-mail (Resend) ──────────────────────────────────────────────────
send_email() {
  local subject="$1" body="$2"
  if [ -z "$RESEND_KEY" ]; then
    logger -t eidosform-wpp-hc "SEM RESEND_API_KEY — alerta não enviado: $subject"
    return 1
  fi
  curl -s --max-time 15 https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null 2>&1 <<JSON
{"from":$(json_str "$FROM"),"to":[$(json_str "$ALERT_TO")],"subject":$(json_str "$subject"),"text":$(json_str "$body")}
JSON
}

# escapa string p/ JSON sem depender de jq
json_str() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }

# alerta com dedup: só dispara na 1ª vez do estado e depois a cada REALERT_SECONDS
alert_once() {
  local key="$1" subject="$2" body="$3"
  local f="$STATEDIR/alert-$key" now last
  now=$(date +%s)
  last=$(cat "$f" 2>/dev/null || echo 0)
  if [ $((now - last)) -ge "$REALERT_SECONDS" ]; then
    send_email "$subject" "$body" && echo "$now" > "$f"
    logger -t eidosform-wpp-hc "ALERTA[$key]: $subject"
  fi
}
clear_alert() { rm -f "$STATEDIR/alert-$1"; }

# marca que houve uma queda (p/ mandar o "voltou ao ar" só se realmente caiu)
DOWN_FLAG="$STATEDIR/was-down"

fail_state() { touch "$DOWN_FLAG"; }
recover_if_needed() {
  if [ -f "$DOWN_FLAG" ]; then
    send_email "✅ WhatsApp do EidosForm voltou ao ar" \
      "O serviço de notificação de lead por WhatsApp está OK de novo ($(date '+%d/%m %H:%M')). Sessão autenticada e serviço respondendo."
    logger -t eidosform-wpp-hc "RECUPERADO"
    rm -f "$DOWN_FLAG"
  fi
  clear_alert svc-down
  clear_alert not-auth
}

# ── 1) serviço vivo? (porta + frescor do status.json) ─────────────────────────
STATUS_AGE=999999
if [ -f "$STATUS_FILE" ]; then STATUS_AGE=$(( $(date +%s) - $(stat -c %Y "$STATUS_FILE") )); fi

if ! curl -sf --max-time 8 "$HEALTH_URL" >/dev/null || [ "$STATUS_AGE" -gt "$STATUS_MAX_AGE" ]; then
  fail_state
  logger -t eidosform-wpp-hc "serviço FORA (health/status velho: ${STATUS_AGE}s) — reiniciando via pm2"
  sudo -u sidney XDG_RUNTIME_DIR=/run/user/$(id -u sidney) \
    /home/sidney/.npm-global/bin/pm2 restart eidosform-whatsapp --update-env >/dev/null 2>&1
  sleep 8
  if curl -sf --max-time 8 "$HEALTH_URL" >/dev/null; then
    alert_once svc-down "🔧 WhatsApp EidosForm: serviço reiniciado" \
      "O serviço estava fora (health falhou ou status.json com ${STATUS_AGE}s) e foi reiniciado via pm2. Está respondendo agora. Verifique se a sessão segue autenticada."
  else
    alert_once svc-down "🚨 WhatsApp EidosForm: serviço NÃO subiu" \
      "O serviço não respondeu nem após pm2 restart. Investigar: pm2 logs eidosform-whatsapp / tail $SVC_DIR/server.log"
  fi
  exit 0
fi

# ── 2) sessão autenticada? ────────────────────────────────────────────────────
AUTH=$(python3 -c "import json;print(json.load(open('$STATUS_FILE')).get('authenticated'))" 2>/dev/null)
if [ "$AUTH" != "True" ]; then
  fail_state
  alert_once not-auth "🔓 WhatsApp EidosForm: sessão CAIU (reparear)" \
"A sessão do WhatsApp do EidosForm está DESCONECTADA (authenticated=false).
Nenhuma notificação de lead está sendo entregue.

Restart não resolve — precisa reparear escaneando o QR:
  1) Gerar o QR:
     curl -s -X POST https://wpp.eidosform.com.br/api/whatsapp/qr \\
       -H \"Authorization: Bearer \$WHATSAPP_API_KEY\" | jq -r .qr | base64 -d > qr.png
  2) WhatsApp do número dedicado -> Aparelhos conectados -> Conectar -> escanear qr.png

Verificar: curl -s https://wpp.eidosform.com.br/api/whatsapp/status -H \"Authorization: Bearer \$WHATSAPP_API_KEY\""
  exit 0
fi

# ── 3) tudo OK ────────────────────────────────────────────────────────────────
recover_if_needed
exit 0
