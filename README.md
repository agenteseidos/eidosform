# EidosForm

**Formulários conversacionais que convertem.**

EidosForm é uma alternativa open-source ao Typeform, desenvolvida pela Eidos. Crie formulários bonitos com experiência de uma pergunta por vez, dark mode nativo e interface 100% em português.

## ✨ Funcionalidades

- 🎯 **Uma pergunta por vez** — experiência focada e conversacional
- 🌙 **Dark mode nativo** — padrão escuro, sem piscar
- 🇧🇷 **Interface em PT-BR** — totalmente em português
- 🎨 **Temas customizáveis** — paleta Eidos: amarelo #F5B731, verde #22C55E
- 📊 **Dashboard de respostas** — visualize e exporte em CSV
- 🔗 **URLs amigáveis** — /f/seu-formulario
- 📁 **Upload de arquivos** — integração com Cloudflare R2
- 🔒 **Autenticação segura** — Google OAuth + Magic Link via Supabase

## 🚀 Começando

### Pré-requisitos

- Node.js 18+
- Conta no Supabase (https://supabase.com)

### Instalação

```bash
git clone https://github.com/yourusername/eidosform.git
cd eidosform
npm install
```

### Configuração

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon
```

Execute o schema em supabase/schema.sql no seu projeto Supabase.

```bash
npm run dev
```

Acesse http://localhost:3000

## 🏗️ Stack

- **Framework:** Next.js 15 (App Router)
- **Estilo:** Tailwind CSS v4 + shadcn/ui
- **Animações:** Framer Motion
- **Auth + DB:** Supabase
- **Storage:** Cloudflare R2 (opcional)

## 🎨 Cores Eidos

- Amarelo: #F5B731 (primária, CTAs)
- Verde: #22C55E (acento, sucesso)

## 📄 Licença

MIT — feito com ❤️ pela Eidos.
