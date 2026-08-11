# EidosForm

Plataforma SaaS de formulários conversacionais com analytics, integrações de pagamento e webhooks.

## Stack

- **Framework:** Next.js 15 (App Router)
- **Banco de Dados:** Supabase (PostgreSQL + RLS)
- **Autenticação:** Supabase Auth (OAuth Google, Magic Link)
- **Storage:** Cloudflare R2 (uploads de arquivo)
- **Pagamentos:** Asaas
- **UI:** Tailwind CSS + shadcn/ui + Framer Motion
- **Linguagem:** TypeScript

## Como rodar localmente

### Pré-requisitos

- Node.js 18+
- Conta no Supabase
- (Opcional) Conta no Cloudflare R2

### 1. Clonar o repositório

```bash
git clone https://github.com/seu-usuario/eidosform.git
cd eidosform
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

Copie o arquivo de exemplo e preencha:

```bash
cp .env.local.example .env.local
```

Edite `.env.local` com suas credenciais (veja seção abaixo).

### 4. Configurar banco de dados

> ⛔ **ARQUIVOS APOSENTADOS — não execute `supabase/schema.sql` nem `supabase/schema_eidosform.sql`.**
>
> Os dois são um **retrato histórico** que sabidamente **diverge do banco real**. Entre outras
> coisas, eles recriam a policy `"Anyone can view published forms"`, removida da produção em
> 29/07/2026: ela deixava qualquer visitante, **sem login**, ler a linha inteira de um formulário
> publicado de qualquer cliente — `webhook_url`, `notify_email`, telefone de notificação,
> `google_sheets_id` — e abria caminho para alterá-lo e apagá-lo. Rodá-los numa instalação nova
> **reabre esse buraco** e entrega os leads do dono do formulário a quem tiver o link. Os arquivos
> abortam sozinhos se forem executados por engano.

**Este repositório não descreve o banco** — leia a **REGRA Nº 1** do [`CLAUDE.md`](CLAUDE.md).
As migrations sempre foram aplicadas à mão, sem registro do que rodou, então o estado verdadeiro
só existe no catálogo do Postgres (`pg_policies`, `pg_proc`, `pg_indexes`, `pg_views`,
`information_schema.role_table_grants`), consultado pelo SQL Editor do painel Supabase.

Para subir um ambiente novo, peça ao dono do projeto o dump do schema do banco vivo.
`supabase/migrations/` serve de **histórico**, não de instalador.

### 5. Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Chave anônima do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Chave de serviço do Supabase (server-side) |
| `R2_ACCOUNT_ID` | ❌ | Account ID do Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | ❌ | Access Key ID do R2 |
| `R2_SECRET_ACCESS_KEY` | ❌ | Secret Access Key do R2 |
| `R2_BUCKET_NAME` | ❌ | Nome do bucket R2 |
| `R2_PUBLIC_URL` | ❌ | URL pública do bucket R2 |
| `RESEND_API_KEY` | ❌ | API Key do Resend (emails) |
| `ASAAS_API_KEY` | ❌ | API Key do Asaas (pagamentos) |
| `ASAAS_WEBHOOK_TOKEN` | ❌ | Token de verificação de webhooks Asaas |
| `NEXT_PUBLIC_APP_URL` | ❌ | URL pública da aplicação |

## Scripts

```bash
npm run dev      # Servidor de desenvolvimento
npm run build    # Build de produção
npm run start    # Iniciar servidor de produção
npm run lint     # Linting
```

## Deploy

O projeto está configurado para deploy na Vercel. Veja [DEPLOY.md](./DEPLOY.md) para instruções detalhadas.

## Licença

Consulte [LICENSE.txt](./LICENSE.txt).
