#!/bin/bash

# Script to fix Nginx timeout for WhatsApp QR endpoint
# Run as: ./fix-nginx-timeout.sh

echo "🔧 Fixing Nginx timeout for WhatsApp API..."

# Copy updated config
sudo cp /home/sidney/eidosform-whatsapp/nginx-updated.conf /etc/nginx/sites-enabled/eidosform-whatsapp-api

# Test nginx config
echo "✓ Testing Nginx config..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "✓ Config valid, reloading Nginx..."
    sudo systemctl reload nginx
    echo "✅ Done! Nginx timeout updated from 30s to 60s"
else
    echo "❌ Nginx config test failed. Reverting..."
    sudo systemctl reload nginx
fi
