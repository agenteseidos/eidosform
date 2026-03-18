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

1. Instalar Vercel CLI: `npm i -g vercel`
2. Na raiz do projeto: `vercel login`
3. Linkar projeto: `vercel link`
4. Deploy preview: `vercel`
5. Deploy produção: `vercel --prod`

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
