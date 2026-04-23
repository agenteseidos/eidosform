## Handoff — Zéfa → Sidney — 2026-04-22 21:52 GMT-3

### Demanda
Mapear o que precisa ser feito para adicionar PIX e Boleto como métodos de pagamento no checkout do EidosForm.

### O que foi feito
Mapeamento completo de código, API Asaas, webhooks e fluxo de ativação.

---

## 1. Como o checkout hospedado do Asaas funciona com múltiplos métodos de pagamento

O checkout hospedado (endpoint `POST /v3/checkouts`) aceita um array `billingTypes` que define quais métodos o usuário pode escolher na tela de pagamento.

**Estado atual** (`lib/asaas.ts`, linha do `createCheckout`):
```js
billingTypes: ['CREDIT_CARD'],
```

**Para adicionar PIX e Boleto**, basta alterar para:
```js
billingTypes: ['CREDIT_CARD', 'PIX', 'BOLETO'],
```

Isso é tudo no lado do Asaas — a tela de checkout hospedado já renderiza os botões de seleção de método automaticamente. O Asaas cuida da geração do QR Code PIX, do código de barras do boleto, etc.

---

## 2. O que precisa mudar no código

### 2.1. `lib/asaas.ts` — `createCheckout()` ⭐ (única mudança obrigatória)
- **Linha:** `billingTypes: ['CREDIT_CARD']`
- **Mudar para:** `billingTypes: ['CREDIT_CARD', 'PIX', 'BOLETO']`
- **Impacto:** Baixíssimo — 1 linha

### 2.2. `components/billing-plans.tsx` — UX (recomendado)
- Atualmente os planos mostram apenas preço e botão "Assinar"
- **Opcional:** adicionar ícones/badges indicando que PIX e Boleto estão disponíveis (ajuda conversão)
- **Impacto:** Baixo — HTML/CSS apenas

### 2.3. `app/(dashboard)/checkout/[plan]/page.tsx` — Nenhuma mudança necessária
- A página apenas redireciona para a URL do checkout hospedado
- A escolha do método acontece na tela do Asaas

### 2.4. `app/api/checkout/[plan]/route.ts` — Nenhuma mudança necessária
- A API cria o checkout e retorna a URL
- Não há seleção de método no backend (é feito no frontend do Asaas)

### 2.5. `components/checkout-success-overlay.tsx` — Nenhuma mudança necessária
- Exibe mensagem genérica de sucesso

---

## 3. Webhook: já cobre PIX e Boleto?

**Sim, parcialmente.** O webhook (`app/api/webhooks/asaas/route.ts`) já trata:

| Evento | Cobre PIX? | Cobre Boleto? |
|--------|-----------|---------------|
| `PAYMENT_CONFIRMED` | ✅ | ✅ |
| `PAYMENT_RECEIVED` | ✅ | ✅ |
| `PAYMENT_OVERDUE` | ✅ | ✅ |
| `SUBSCRIPTION_DELETED` | ✅ | ✅ |

**Importante:** O Asaas dispara `PAYMENT_RECEIVED` quando PIX é confirmado (instantâneo, geralmente < 5 min) e quando boleto é compensado (até 3 dias úteis). O webhook já trata ambos os eventos de forma idêntica — ativa o plano.

**⚠️ Evento extra recomendado:** `PAYMENT_PENDING` — o Asaas dispara quando um boleto é gerado mas ainda não foi pago. Pode ser útil para:
- Mostrar status "Aguardando pagamento do boleto" na UI
- Não é obrigatório para MVP

---

## 4. Fluxo de ativação de plano: PIX vs Boleto

### PIX (instantâneo)
- Usuário paga → Asaas confirma → webhook `PAYMENT_RECEIVED` → plano ativado
- **Latência típica:** segundos a poucos minutos
- **Sem mudança necessária** no fluxo atual

### Boleto (até 3 dias úteis)
- Usuário recebe código de barras → paga no banco/app → compensação → webhook `PAYMENT_RECEIVED` → plano ativado
- **Janela:** até 3 dias úteis (boleto vence geralmente em 1-3 dias)
- **Risco:** se o boleto expirar sem pagamento, Asaas dispara `PAYMENT_OVERDUE`

### Mudanças recomendadas no fluxo:

1. **`app/api/checkout/status/route.ts`** — Atualmente trata `pending` como "aguardando". Funciona para PIX e Boleto. **Nenhuma mudança obrigatória**, mas seria ideal diferenciar visualmente na UI:
   - "PIX gerado — aguardando pagamento" vs "Boleto gerado — pague até DD/MM"

2. **`app/(dashboard)/billing/page.tsx`** — Verificar como o status de "pending" é exibido. Pode melhorar a UX mostrando instruções específicas por método de pagamento.

3. **`billing_checkouts` table** — Adicionar coluna `payment_method` (nullable) para saber qual método o usuário escolheu. O Asaas envia essa info nos webhooks de pagamento, mas hoje não é salva.

### Fluxo de downgrade (boleto expirado)
- Já funciona: `PAYMENT_OVERDUE` → downgrade para free
- **Sem mudança necessária**

---

## 5. Complexidade e dependências

### Complexidade: **BAIXA** ⭐

Isso é surpreendentemente simples porque:
- O Asaas checkout hospedado já suporta múltiplos métodos nativamente
- A mudança principal é 1 linha de código
- Os webhooks já tratam PIX e Boleto

### Mudanças obrigatórias (MVP):
1. `lib/asaas.ts`: mudar `billingTypes` — **1 linha**

### Mudanças recomendadas (UX/polimento):
2. `components/billing-plans.tsx`: indicar PIX/Boleto disponíveis — **HTML/CSS**
3. `app/(dashboard)/billing/page.tsx`: melhorar UX de status pending — **frontend**
4. `billing_checkouts` table: adicionar coluna `payment_method` — **migration + webhook update**

### Dependências externas:
- **Nenhuma.** O Asaas já suporta PIX e Boleto na API de checkout hospedado.
- **Nenhuma configuração extra** no painel do Asaas necessária.

### Riscos:
- **Baixo.** Mudança não-invasiva — adiciona opções, não remove nenhuma.
- Cartão de crédito continua funcionando exatamente como antes.

---

## Resumo executivo

| Item | Status |
|------|--------|
| Checkout Asaas (multi-método) | ✅ Suportado nativamente |
| Mudança no código (MVP) | 1 linha em `lib/asaas.ts` |
| Webhooks PIX/Boleto | ✅ Já cobertos |
| Fluxo de ativação | ✅ Funciona sem mudança |
| UX/Polimento | Recomendado, não obrigatório |
| Complexidade | Baixa |
| Dependências externas | Nenhuma |

### Arquivos mapeados
- `lib/asaas.ts` (criação do checkout — mudança principal)
- `app/api/checkout/[plan]/route.ts` (API route — sem mudança)
- `app/api/webhooks/asaas/route.ts` (webhook — já cobre PIX/Boleto)
- `app/api/checkout/status/route.ts` (status polling — funciona como está)
- `app/(dashboard)/checkout/[plan]/page.tsx` (página checkout — sem mudança)
- `components/billing-plans.tsx` (cards de planos — polimento UX)

### Pendências
- Implementar a mudança (1 linha + UX opcional)
- Testar PIX e Boleto em sandbox do Asaas

### Próximo passo
- Sidney decide se faz só a 1 linha (MVP) ou inclui polimento UX
