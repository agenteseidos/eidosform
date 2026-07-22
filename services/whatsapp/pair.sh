#!/bin/bash
# Parear a sessão WhatsApp do EidosForm (notificação de lead) — gera o QR e mostra
# no terminal pra escanear com o WhatsApp do NÚMERO DEDICADO.
#
# Uso:  bash /home/sidney/eidosform/services/whatsapp/pair.sh
# No celular do número dedicado: WhatsApp → Aparelhos conectados → Conectar um aparelho
#                                 → escanear o QR abaixo (dura ~60s; rerode se expirar).
set -u
SVC_DIR=/home/sidney/eidosform/services/whatsapp
KEY=$(grep -oP '^WHATSAPP_API_KEY=\K.*' "$SVC_DIR/.env" | tr -d '"'"'"'\r')
BASE=${1:-https://wpp.eidosform.com.br}

echo "Gerando QR (pode levar alguns segundos)..."
RESP=$(curl -s --max-time 20 -X POST "$BASE/api/whatsapp/qr" -H "Authorization: Bearer $KEY")
if ! echo "$RESP" | grep -q '"qr"'; then
  echo "FALHOU ao gerar QR. Resposta: $RESP"
  echo "Confira: pm2 list | grep eidosform-whatsapp  e  tail $SVC_DIR/server.log"
  exit 1
fi
# Mostra o QR em ASCII (mais confiável de escanear no terminal que o PNG)
if [ -f "$SVC_DIR/latest-qr.txt" ]; then
  echo; cat "$SVC_DIR/latest-qr.txt"; echo
  echo "↑ Escaneie com o WhatsApp do número dedicado (Aparelhos conectados → Conectar)."
  echo "  QR expira em ~60s — se sumir, rode este script de novo."
else
  echo "QR gerado (PNG em $SVC_DIR/latest-qr.png), mas sem ASCII. Abra o PNG pra escanear."
fi
echo
echo "Depois de escanear, confirme com:"
echo "  curl -s $BASE/api/whatsapp/status -H \"Authorization: Bearer \$KEY\""
echo "  (esperado: {\"authenticated\":true,\"connected\":true,...})"
