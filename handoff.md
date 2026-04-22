## Handoff — Zéfa — 2026-04-22 14:12 GMT-3

### O que foi feito
- Auditoria do bug "Erro ao buscar CEP" na tela de billing profile/settings do EidosForm.
- Teste de conectividade com ViaCEP via curl (200 OK, CORS liberado).
- Análise do CSP no next.config.ts.
- Revisão estática completa do componente `components/settings/billing-profile-settings.tsx`.

### Arquivos auditados
- `components/settings/billing-profile-settings.tsx`
- `next.config.ts`

### Diagnóstico

#### Causa raiz: CSP `connect-src` bloqueia `fetch` ao ViaCEP — **P0**

- **Arquivo:** `next.config.ts`, headers `protectedAppHeaders`
- **Detalhe:** A diretiva `connect-src` do Content-Security-Policy lista apenas domínios permitidos para conexões de rede (fetch, XHR, WebSocket). O domínio `https://viacep.com.br` **não está incluído**. Quando o browser executa `fetch("https://viacep.com.br/ws/...")`, o CSP bloqueia a requisição, o fetch lança `TypeError`, cai no `catch {}` do `lookupCep()` e exibe o toast "Erro ao buscar CEP".
- **Severidade:** P0 — funcionalidade 100% quebrada em produção para todos os usuários.
- **Correção recomendada:** Adicionar `https://viacep.com.br` à diretiva `connect-src` em ambas as configurações (`protectedAppHeaders` e `embeddableFormHeaders`) no `next.config.ts`.
  ```
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.asaas.com https://www.facebook.com ... https://viacep.com.br
  ```

#### Ausência de debounce no CEP — **P2**

- **Arquivo:** `components/settings/billing-profile-settings.tsx`
- **Detalhe:** `lookupCep()` é chamado em cada `onChange` do input do CEP. Sem debounce, cada tecla dispara uma requisição (embora só processe quando `cep.length === 8`). Com a correção do CSP, isso fará múltiplos fetches desnecessários quando o usuário digita os últimos dígitos rapidamente. Não causa bug funcional, mas desperdiça requisições e pode causar race condition (resposta de CEP anterior chegando depois).
- **Severidade:** P2
- **Correção recomendada:** Adicionar debounce de ~300ms no `lookupCep`, ou mover a chamada para `onBlur`.

#### Campo `state` (UF) não preenchido pelo ViaCEP — **P2**

- **Arquivo:** `components/settings/billing-profile-settings.tsx`
- **Detalhe:** A resposta do ViaCEP inclui `data.uf` (estado), mas o `setForm` no `lookupCep` não preenche esse campo. O modelo de dados `initialData` não inclui `state`/`uf`. Se o backend ou o Asaas precisam do estado, ele ficará vazio. (Verificar se o Asaas exige `state` no billing profile.)
- **Severidade:** P2 (depende de o Asaas exigir UF)

### O que NÃO é problema
- **CORS do ViaCEP:** Liberado (`Access-Control-Allow-Origin: *`). Não é causa.
- **Lógica de formatação do CEP:** `rawCep.replace(/\D/g, '')` está correta.
- **Response parsing:** Verifica `data.erro` corretamente.
- **Hydration/client-only:** Componente é `'use client'`, sem conflito.
- **Ordem dos campos UX:** Razoável (nome → email → telefone/CPF → CEP → endereço → número → complemento → bairro → cidade).

### Estado atual
- Bug 100% reproduzível: CSP bloqueia ViaCEP → toast de erro em toda requisição.
- ViaCEP está acessível e com CORS aberto.

### Pendências
- P0: Adicionar `https://viacep.com.br` ao `connect-src` do CSP.
- P2: Adicionar debounce no lookup do CEP.
- P2: Verificar se UF é necessário e adicioná-lo ao preenchimento automático.

### Próximo passo sugerido
- Corrigir o CSP imediatamente (1 linha em cada header block do next.config.ts) → deploy → validar.
