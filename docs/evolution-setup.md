# Evolution Server Setup — EidosForm WhatsApp API

**Status:** 🚀 Setup Guide & Deployment Plan  
**Date:** 2026-04-04  
**Responsible:** Zeca (Backend Agent)

---

## Overview

Evolution API é o servidor que conecta uma conta WhatsApp Business ao EidosForm via REST API. Permite enviar/receber mensagens programaticamente.

**Arquitetura:**
```
EidosForm (Next.js) 
    ↓ (HTTP REST calls)
Evolution Server (Node.js + WhatsApp Web)
    ↓ (WhatsApp Web protocol)
WhatsApp Business Account
```

---

## PASSO 1: Provisionar VPS (DigitalOcean)

### 1.1 Criar Droplet

**Recomendações:**
- **OS:** Ubuntu 22.04 LTS
- **Plan:** Basic ($6/month, 2GB RAM, 1 vCPU, 50GB SSD)
- **Region:** New York 3 (NYC3) ou São Paulo (sfo) conforme latência
- **Auth:** SSH key (mais seguro que password)

**Steps:**
1. Login em DigitalOcean dashboard
2. Create → Droplets
3. Choose Image: Ubuntu 22.04 LTS
4. Choose Size: Basic $6/month (2GB RAM)
5. Choose Region: NYC3 ou SFO (testar ping)
6. SSH Key: Adicionar public key do seu local (ou gerar)
7. Hostname: `evolution-api-eidosform`
8. Create Droplet

**⏱️ Tempo:** ~2 minutos

**📝 Anote:**
- [ ] IP da VPS: `_______________`
- [ ] Hostname: evolution-api-eidosform
- [ ] Region: _______________

---

## PASSO 2: Setup Inicial da VPS

### 2.1 SSH na VPS

```bash
ssh root@<seu-ip-vps>
# Ou se configurou SSH key com nome específico:
ssh -i ~/.ssh/id_rsa root@<seu-ip-vps>
```

### 2.2 Atualizar Sistema

```bash
apt update && apt upgrade -y
apt install -y curl wget git htop
```

### 2.3 Instalar Docker & Docker Compose

```bash
# Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker root

# Docker Compose (já vem com Docker no script acima)
docker --version
docker-compose --version
```

**⏱️ Tempo:** ~3 minutos

---

## PASSO 3: Instalar Evolution API

### 3.1 Clonar Repository

```bash
cd /opt
git clone https://github.com/EvolutionAPI/evolution-api.git
cd evolution-api
```

### 3.2 Preparar Environment

```bash
# Copiar arquivo de exemplo
cp .env.example .env

# Editar com valores necessários
nano .env
```

**Variáveis críticas no `.env`:**
```env
# Server
SERVER_PORT=3000
SERVER_URL=http://<seu-ip-vps>:3000

# Database (SQLite padrão, ou PostgreSQL se preferir)
DATABASE_URL=sqlite:./database.sqlite

# JWT Secret (gerar um token seguro)
JWT_SECRET=sua-chave-super-secreta-aqui-minimo-32-caracteres

# Nome da instância padrão
INSTANCE_NAME=eidosform-plus
```

**Gerar JWT_SECRET seguro:**
```bash
openssl rand -base64 32
```

### 3.3 Iniciar Evolution via Docker Compose

```bash
# Verificar docker-compose.yml
cat docker-compose.yml

# Iniciar serviço em background
docker-compose up -d

# Verificar status
docker-compose ps
docker logs -f evolution-api  # Ver logs em tempo real
```

**⏱️ Tempo:** ~1 minuto (depois pull de imagem, ~2-3 min total)

---

## PASSO 4: Verificar Instalação

### 4.1 Acessar Dashboard

Abrir no navegador:
```
http://<seu-ip-vps>:3000
```

**Esperado:**
- UI do Evolution carregar
- Opção para fazer login ou cadastro
- Menu para conectar conta WhatsApp

### 4.2 Criar Conta & Login

1. Cadastro: Email + Password
2. Login com credenciais
3. Dashboard carrega

### 4.3 Conectar Conta WhatsApp

1. No dashboard, clicar em "Conectar WhatsApp" ou similar
2. QR Code aparece
3. Usar seu celular (WhatsApp instalado) para ler QR
4. Aceitar conexão
5. Voltar ao dashboard — conta agora conectada ✅

**⏱️ Tempo:** ~2 minutos

**📝 Anote:**
- [ ] WhatsApp número conectado: `_______________`
- [ ] Status no dashboard: ✅ Connected

---

## PASSO 5: Gerar API Token

### 5.1 No Dashboard Evolution

1. Settings → API Keys (ou similar)
2. Create New Token
3. Nome: "eidosform-api"
4. Copiar token completo

**Token terá formato similar:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMzQ1Njc4OTAifQ...
```

**📝 Anote (GUARDAR COM SEGURANÇA):**
- [ ] API Token: `_______________`

### 5.2 Armazenar em `.env` do EidosForm

No seu projeto EidosForm, adicionar:
```env
EVOLUTION_API_URL=http://<seu-ip-vps>:3000
EVOLUTION_API_TOKEN=<seu-token-aqui>
EVOLUTION_INSTANCE=eidosform-plus
```

---

## PASSO 6: Testar Endpoint

### 6.1 Teste via cURL (do seu local)

```bash
curl -X POST http://<seu-ip-vps>:3000/message/sendText \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_API_TOKEN" \
  -d '{
    "number": "5511987654321",
    "text": "Teste Evolution desde EidosForm!",
    "instance": "eidosform-plus"
  }'
```

**Resposta esperada (sucesso):**
```json
{
  "success": true,
  "message": {
    "key": { "remoteJid": "5511987654321@s.whatsapp.net" },
    "messageTimestamp": 1712282400,
    "pushName": "Evolution API"
  }
}
```

**Status code:** `200 OK`

### 6.2 Verificar Mensagem Recebida

- Conferir no WhatsApp se a mensagem chegou no número
- Se chegou → ✅ API funcionando!

---

## PASSO 7: Segurança & Hardening

### 7.1 Firewall na VPS

```bash
# Usar ufw (firewall simples)
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 3000/tcp  # Evolution API
ufw enable
```

### 7.2 HTTPS (Opcional, mas recomendado)

Se tiver domínio, usar Let's Encrypt:
```bash
apt install -y certbot
certbot certonly --standalone -d seu-dominio.com
# Copiar certs para Evolution (ver docs do Evolution para nginx reverse proxy)
```

### 7.3 Monitoramento

```bash
# Criar cron job para monitorar saúde
cat > /opt/evolution-api/health-check.sh << 'EOF'
#!/bin/bash
curl -s http://localhost:3000/health || docker-compose restart
EOF

chmod +x /opt/evolution-api/health-check.sh

# Adicionar ao crontab
crontab -e
# Adicionar: */5 * * * * /opt/evolution-api/health-check.sh
```

---

## RESUMO DE CONFIGURAÇÃO

### URLs & Credenciais

- **URL servidor:** `http://<seu-ip-vps>:3000`
- **API Token:** `[GUARDADO COM SEGURANÇA]`
- **Instância:** `eidosform-plus`
- **WhatsApp conectado:** `[seu-numero]`
- **Status de teste:** ✅ Funcional

### Checklist de Setup

- [ ] VPS provisionada (DigitalOcean Ubuntu 22.04)
- [ ] Docker & Docker Compose instalados
- [ ] Evolution API clonado e iniciado
- [ ] Dashboard acessível em http://<ip>:3000
- [ ] Conta WhatsApp conectada
- [ ] API token gerado e armazenado
- [ ] Teste cURL retorna 200 OK
- [ ] Firewall configurado (portas 22, 3000)
- [ ] `.env` do EidosForm atualizado
- [ ] Mensagem recebida com sucesso no WhatsApp

---

## Troubleshooting

### Evolution não inicia

```bash
# Ver logs detalhados
docker logs evolution-api

# Reiniciar
docker-compose restart

# Verificar espaço em disco
df -h

# Verificar RAM disponível
free -h
```

### API Token não funciona

1. Verificar se token foi copiado corretamente (sem espaços)
2. Regenerar token no dashboard
3. Testar novamente

### WhatsApp não conecta

1. Abrir QR code novamente
2. Escanear com celular novo (pode exigir logout em outro dispositivo)
3. Alguns números podem ser bloqueados — testar com outro
4. Ver logs: `docker logs evolution-api`

### Firewall bloqueando conexão

```bash
# Verificar regras
ufw status

# Se necessário, reabrir porta
ufw allow 3000/tcp
```

---

## Próximos Passos

1. ✅ Setup completo
2. 🔄 Integrar Evolution API no EidosForm backend
   - Implementar endpoint `/api/whatsapp/send`
   - Tratar webhooks do Evolution (incoming messages)
3. 🧪 Testar fluxo completo (formulário → mensagem WhatsApp)
4. 📊 Monitoramento em produção

---

**Setup completado por:** Zeca  
**Data:** 2026-04-04  
**Próxima revisão:** Após 1 semana em produção
