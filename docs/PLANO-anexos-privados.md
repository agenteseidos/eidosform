# Plano de execução — anexos deixam de morar em URL pública permanente

> Decidido em 16/08/2026, após parecer independente do Codex sobre o desenho proposto.
> **Janela:** o EidosForm ainda não vende. Zero cliente pagante, zero link circulando em planilha
> de terceiro. Toda a quebra é limpa hoje e vira migração dolorosa na primeira venda.

---

## 1. O QUE ESTÁ ERRADO HOJE (verificado no código e no catálogo)

**Os dois buckets são públicos** (`storage.buckets`, consulta rodada em 16/08):
`form-images` (imagem de boas-vindas do dono — **correto ser público**) e `form-uploads`
(arquivo que o RESPONDENTE envia — **é o problema**).

O arquivo do respondente fica numa URL **pública, permanente, sem login e sem expiração**. Não
existe hoje forma de revogar, expirar ou saber que foi acessado.

### As SEIS saídas por onde essa URL escapa
Meu briefing original mapeou três. O Codex achou as outras três:

| Saída | Onde |
|---|---|
| Painel do dono | `components/responses/responses-dashboard.tsx:298` |
| Google Sheets | `lib/google-sheets.ts:324` |
| Webhook (CRM do cliente) | `lib/webhook-dispatcher.ts:270` |
| **E-mail** ⚠️ | `lib/answer-format.ts:61` via `notification-model.ts` — eu afirmei que NÃO carregava; carrega |
| **WhatsApp** ⚠️ | `lib/answer-format.ts:61` (`📎 nome\nurl`) |
| **Export CSV/XLSX/PDF** ⚠️ | `app/api/forms/[id]/export/route.ts:129` |

E `answer_items.value` duplica o objeto inteiro, com a URL dentro.

### Dois defeitos INDEPENDENTES do redesenho, achados no caminho

**(a) Replay entre formulários — existe HOJE.** `app/api/upload/sign-url/route.ts` amarra o
caminho ao dono, ao formulário e à pergunta na hora de assinar. Mas `lib/field-validators.ts:364`
só confere se a URL começa com o prefixo do bucket. Dá para pegar a URL de um anexo de um
formulário e gravá-la como resposta de outro. **Trocar o prefixo público pelo nosso NÃO corrige
isto** — é preciso validar contra o registro do arquivo.

**(b) Excluir não apaga o arquivo.** Apagar resposta, formulário ou conta não remove nada do
storage (`app/api/forms/[id]/route.ts`, `app/api/account/delete/route.ts` — sem chamada de
remoção). E `app/(public)/privacidade/page.tsx` promete: *"após exclusão da conta, dados pessoais
são anonimizados ou deletados em até 30 dias"*. **É promessa publicada que o sistema não cumpre**,
e o arquivo sobrevive num endereço público.

---

## 2. O DESENHO (após a correção do Codex)

**Invariante:** nenhum endereço **público e permanente** de storage no mundo. (Redação honesta: a
rota redireciona para uma URL assinada de curta duração, então o navegador ainda vê um endereço
do Supabase — curto e privado. Esconder por completo exigiria proxy dos bytes, caro e adiado.)

**O arquivo vira ENTIDADE no banco** (`form_files`), não um caminho embutido num token. Cada
acesso resolve: token → arquivo → formulário → dono atual → modo atual → revogado/expirado?

Isto é o que o Codex corrigiu na minha proposta, e ele está certo: autorizar pelo `user_id`
embutido no caminho quebra em transferência de formulário, e um HMAC do caminho não permite
revogar, expirar nem limpar.

**Política POR FORMULÁRIO**, escolhida pelo dono:
- **Somente eu** (padrão) — só o dono do formulário, logado, abre.
- **Qualquer pessoa com o link** — abre sem login, mas pelo endereço nosso: revogável, expirável,
  auditável. Trocar para "Somente eu" **incrementa a versão** e mata os links já distribuídos.

**O que fica gravado na resposta** (não mais a URL):
```json
{ "kind": "stored_file", "file_id": "uuid", "name": "curriculo.pdf",
  "type": "application/pdf", "size": 123456 }
```
A URL é montada **na borda**, por cada uma das seis saídas. Para compatibilidade, o webhook pode
continuar recebendo `{name,type,size,url}` + `file_id`.

---

## 3. ORDEM DE EXECUÇÃO

| # | Entrega | Estimativa |
|---|---|---|
| 0 | **Consultas de catálogo** (Sidney no SQL Editor): policies e grants de `storage.objects`, colunas/constraints das tabelas envolvidas, agregados sanitizados dos formatos de anexo hoje | 0,5 dia |
| 1 | `form_files` + modo/versão por formulário + RLS + auditoria | 1,5–2 dias |
| 2 | Token (segredo DEDICADO `FILE_LINK_SECRET`) + rota `/arquivo/[token]` + autorização + redirect + revogação | 1,5–2 dias |
| 3 | Upload `pending`→`finalize` com verificação REAL (magic bytes, tamanho, MIME) + **validador comum nas 4 rotas que gravam resposta** (fecha o replay entre formulários) | 2–3 dias |
| 4 | Builder (o interruptor) + **as 6 saídas** | 1,5–2 dias |
| 5 | Backfill, limpeza de órfãos, **exclusão real** (fecha a promessa da política), bucket privado | 1–2 dias |
| 6 | E2E, segurança, falhas, rollback | 1–2 dias |

**Total realista: 8–12 dias.** Minha estimativa inicial era "uma sessão" — estava errada porque
eu tinha mapeado três saídas, não seis, e não tinha visto a tabela de arquivos nem a verificação
de conteúdo.

### Rollout sem interromper resposta pública
1. Criar schema e rota **sem tocar no bucket**
2. Rota lê arquivo antigo E novo
3. Validadores aceitam referência antiga E nova
4. Upload novo atrás de feature flag
5. Migrar `responses.answers`, `answer_items` e planilhas conhecidas
6. Confirmar que **nenhum escritor** produz mais URL crua
7. **Só então** fechar o bucket e remover policy de SELECT para `public`/`anon`
8. Smokes nos dois modos
9. Remover compatibilidade antiga e limpar órfãos

---

## 4. O QUE FICA DE FORA DESTE CICLO
- **Link temporário por arquivo** (mandar um anexo ao contador sem abrir o formulário) — feature
  própria, com token e expiração próprios. Esperar demanda.
- **Proxy dos bytes** (esconder o endereço do Supabase por completo e tornar a revogação
  instantânea). Hoje, emitida a URL assinada de ~60s, ela vale até expirar.
- `form-images` continua público — é a imagem que o dono publica para todo visitante ver.

## 5. RISCOS E DETALHES QUE O CODEX LEVANTOU E DEVEM ENTRAR
Órfãos (upload sem submit → limpar `pending` não reclamado em 24h) · MIME real por magic bytes ·
`Cache-Control: private, no-store` e nunca cachear redirect aberto em CDN · `Referrer-Policy:
no-referrer` · `Content-Disposition: attachment` + `nosniff` · rate limit por IP/arquivo no modo
aberto · não logar token, URL assinada nem nome de arquivo · varredores de link (Gmail, antivírus)
"abrem" links sozinhos — o log não pode prometer leitura humana · duplicar formulário copia a
política mas NÃO os registros de arquivo · trocar de modo exige confirmação explícita, porque
abrir um formulário expõe **anexos históricos**, não só os futuros.

## 6. LGPD
Alinha com o art. 46 (segurança desde a concepção, proteção contra acesso não autorizado). O ponto
mais urgente não é o bucket em si: é a **política publicada prometer exclusão que não acontece** e
não descrever Resend, Google Sheets, WhatsApp e webhook como destinos possíveis dos dados.
