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
