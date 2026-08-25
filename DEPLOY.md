# Deploy na Vercel — EidosForm

## Variáveis de Ambiente Obrigatórias

Configure estas variáveis no painel da Vercel (Settings → Environment Variables):

### Supabase (Obrigatórias)
| Variável | Descrição | Onde encontrar |
|----------|-----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase | Dashboard Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon/public | Dashboard Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role (server-side only) | Dashboard Supabase → Settings → API |

### Google OAuth (Após Sidney configurar no Google Cloud Console)
| Variável | Descrição |
|----------|-----------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |

## Passos para Deploy

> ⚠️ **NÃO use `vercel --prod`.** Esse comando sobe o **diretório local**, não o que
> está na `main` do GitHub — inclusive trabalho não commitado e commits atrasados.
> Em 2026-07-28 ele quase publicou uma árvore 5 commits atrás da `main`.

**Deploy = `git push origin main`.** A Vercel builda produção sozinha e começa em ~2
segundos (confirmado em 5 pushes de 2026-07-28, todos `source: git`).

### ⚠️ Confirme sempre — o push pode não virar deploy

Em 2026-07-28, dois pushes na `main` (`202eb8d` 20:53 e `f45050b` 21:01) **não geraram
deployment nenhum**, enquanto todos os outros do mesmo dia geraram em 2 segundos. Causa
não determinada (a Vercel integra pelo GitHub App; o repo não tem webhook próprio para
inspecionar). O trabalho ficou ~1h30 parado, "publicado" só na cabeça de quem empurrou.

```bash
VTOKEN="$(tr -d '\r\n' < /home/sidney/.eidos-credentials/produtos/vercel.token)"
vercel ls --token "$VTOKEN" --yes | head -4   # o commit novo TEM que aparecer
```

Se não apareceu em ~1 min, dispare o **deploy hook** (builda a partir do GitHub, ref `main`):

```bash
curl -s -X POST "https://api.vercel.com/v1/integrations/deploy/prj_jJm0RRHflPOUmM5feB8vfUYjJq20/hsbpPojR5P"
```

E confirme **no ar**, não na lista: `curl -s https://eidosform.com.br/<rota>` procurando uma
string que só existe na versão nova.

⚠️ **Nunca conclua "tal commit não está em produção" sem `git ls-remote`** — a ref local
`origin/main` fica velha e já causou pânico falso mais de uma vez.

### Crons

A conta é **Hobby** (máx. 2 crons, só diários). Por isso o `vercel.json` agenda **apenas**
`expire-plans` (diário). Os demais rodam na VPS e **não devem ser duplicados aqui**:

| Job | Onde roda |
|---|---|
| `expire-plans` | Vercel, `0 3 * * *` |
| `reconcile-checkouts` | crontab da VPS (`7 * * * *`) |
| `sweep-received` | crontab da VPS (`22 * * * *`) |
| `reconcile-subscriptions` | crontab da VPS (`37 * * * *`) |
| `abandoned-leads` | timer systemd `eidosform-abandoned.timer` (15 min) |
| `abandoned-leads-email` | timer systemd `eidosform-abandoned-email.timer` (15 min) — **⚠️ ainda NÃO instalado** |

### Agendar o `abandoned-leads-email` (pendente — Sidney)

Ordem obrigatória: **(1)** rodar a migração
`supabase/migrations-manual/2026-07-30-alerta-abandono-email.sql` no SQL Editor →
**(2)** subir o deploy → **(3)** só então agendar. Sem a tabela, o endpoint falha
fechado (`stage: 'migracao-ausente'`) e não manda nada — de propósito.

O `run-cron.sh` já aceita qualquer endpoint, então basta um par unit/timer novo
espelhando o do WhatsApp:

```ini
# /etc/systemd/system/eidosform-abandoned-email.service
[Unit]
Description=EidosForm - alerta de lead abandonado por E-MAIL
[Service]
Type=oneshot
User=sidney
ExecStart=/home/sidney/.eidos-credentials/produtos/run-cron.sh abandoned-leads-email
StandardOutput=append:/home/sidney/.eidos-credentials/produtos/cron.log
StandardError=append:/home/sidney/.eidos-credentials/produtos/cron.log
```

```ini
# /etc/systemd/system/eidosform-abandoned-email.timer
[Unit]
Description=Dispara o alerta de lead abandonado por e-mail a cada 15 min
[Timer]
OnBootSec=7min
OnUnitActiveSec=15min
# Defasado do timer de WhatsApp de propósito: os dois varrem `responses` e não
# há motivo para baterem no banco no mesmo segundo.
RandomizedDelaySec=90
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eidosform-abandoned-email.timer
systemctl list-timers | grep abandoned          # confere os dois
```

Teste manual (sem esperar o timer):
`/home/sidney/.eidos-credentials/produtos/run-cron.sh abandoned-leads-email`

## Configurar Google OAuth no Supabase (Pendente — Sidney)

1. Acessar [Google Cloud Console](https://console.cloud.google.com)
2. Criar projeto ou selecionar existente
3. Habilitar Google+ API ou Google Identity
4. Criar credenciais OAuth 2.0 (Web Application)
5. Adicionar Authorized redirect URI:
   ```
   https://srqtjoakjzzmpzauvoxc.supabase.co/auth/v1/callback
   ```
6. No [Supabase Dashboard](https://supabase.com/dashboard/project/srqtjoakjzzmpzauvoxc/auth/providers):
   - Authentication → Providers → Google
   - Habilitar toggle
   - Inserir Client ID e Client Secret do Google
   - Salvar

## Callback URL do Supabase Auth
```
https://srqtjoakjzzmpzauvoxc.supabase.co/auth/v1/callback
```

## URL de Produção (preencher após deploy)
```
https://eidosform.vercel.app  (ou domínio customizado)
```


## ⚠️ 25/08/2026 — `expire-plans` passou a rodar na VPS (o cron da Vercel não é confiável)

**O que aconteceu:** no teste real da régua de cobrança, o rebaixamento do D+5 **não ocorreu** à
meia-noite. O cron da Vercel (`vercel.json`, `0 3 * * *`) estava configurado, habilitado e
apontando para o deployment atual — e simplesmente não disparou. Rodado à mão às 09:08 BRT,
reverteu na hora (`reverted: 1`), provando que a lógica estava certa: o problema era o AGENDADOR.

**Por que importa:** `expire-plans` é o job que protege a RECEITA — é ele que tira o acesso pago
de quem parou de pagar. Um dia sem rodar é um dia de acesso pago de graça, silencioso.

**Por que não dá para confiar:** a Vercel documenta, no plano Hobby, atraso de **até 59 minutos**
([docs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)) — o real foi **9h+**. E o Hobby não
tem log de runtime, então não há como auditar se rodou.

**Correção:** entrou no crontab do `sidney` (`20 3 * * *` UTC = 00:20 BRT), pelo mesmo
`run-cron.sh` dos outros 5 jobs, gravando em `cron.log`. **O cron da Vercel FICA como reserva** —
`expire-plans` é idempotente (provado: segunda execução seguida devolveu `total: 0`), então rodar
duas vezes não causa dano.

**Quando migrar para o Vercel Pro** (decisão do Sidney: ao fechar 2 assinaturas pagas), revisitar:
no Pro o cron dispara dentro do minuto e há log de runtime. Ainda assim, manter o da VPS não
custa nada e dá observabilidade em arquivo.
