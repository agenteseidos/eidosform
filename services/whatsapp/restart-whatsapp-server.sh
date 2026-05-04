#!/bin/bash
# Run this as root to restart the WhatsApp server with the fixed code
# Usage: sudo bash /home/sidney/eidosform/services/whatsapp/restart-whatsapp-server.sh

echo "Restarting EidosForm WhatsApp server..."
pm2 restart eidosform-whatsapp 2>/dev/null || \
  (pkill -f "eidosform-whatsapp/server.js" && \
   sleep 1 && \
   cd /home/sidney/eidosform/services/whatsapp && \
   pm2 start server.js --name eidosform-whatsapp)

echo "Waiting for server to start..."
sleep 2
curl -s http://127.0.0.1:3457/api/whatsapp/status -H "Authorization: Bearer $(grep WHATSAPP_API_KEY /home/sidney/eidosform/services/whatsapp/.env | cut -d= -f2)"
echo ""
echo "Done."
