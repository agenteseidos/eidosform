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
| `expire-plans` | Vercel, `0 3 * * *` (= 00:00 BRT) **+ backstop na VPS `10 1 * * *`** (01:10 BRT, hora local) |
| `reconcile-checkouts` | crontab da VPS (`7 * * * *`) |
| `sweep-received` | crontab da VPS (`22 * * * *`) |
| `reconcile-subscriptions` | crontab da VPS (`37 * * * *`) |
| `nfse-retry` | crontab da VPS (`41 * * * *`) — reenvia NFS-e rejeitada; teto de 6 tentativas + alerta |
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


## ⚠️ 25/08/2026 — `expire-plans` ganhou backstop na VPS, alarme próprio e SLA

> **Correção de redação (26/08).** A primeira versão desta seção — e o commit `b5e21bb`, e um
> comentário no crontab — afirmavam que o cron da Vercel *"simplesmente não disparou"*. **Isso
> nunca foi medido.** No Hobby o log de runtime é retido por 1 hora (às 09:07 o das 03:00 já
> tinha expirado), `/v3/events` não expõe execução de cron, e nada nesta VPS observa invocação
> vinda da Vercel: a hipótese é **infalsificável** a partir da evidência disponível. Ficou como
> lição: inferência plausível não vira fato só porque nada a contradiz.

**O que foi MEDIDO:** às 09:07 BRT o perfil ainda estava `plan='plus'`, `plan_status='active'`,
`downgraded_at=null` — o rebaixamento **não tinha ocorrido** ~9h depois do horário devido. Rodado
à mão às 09:08, reverteu na hora (`reverted: 1`); a segunda execução devolveu `total: 0`. Foram
eliminados por prova: carência ainda válida, extensão bem-sucedida, linha fora da consulta
(`plan_expires_at` era `2026-08-21T02:59:59Z`, 4 dias no passado) e apagão de log da VPS.

**O que NÃO foi determinado:** a causa. Seguem vivas — e indistinguíveis — falha da consulta ao
Asaas, exceção no `getSubscription`, falha de escrita, timeout de 30s com uma chamada pendurada,
e "não disparou".

**Por que importa:** `expire-plans` protege a RECEITA — é ele que tira o acesso pago de quem
parou de pagar. Um dia sem rodar é um dia de acesso pago de graça, silencioso.

**O achado maior:** o watchdog que existia para exatamente isso (`detectarRebaixamentoAtrasado`,
na régua, de 30 em 30 min) ficou mudo por um sinal de comparação — exigia `dias > 5` enquanto o
rebaixamento acontece em `dias >= 5`. **O dia devido era ponto cego por construção.** Rodou 75
vezes durante o incidente com `alertasRebaixamento: 0`.

**O que mudou (25/08):**
- Detector: `dias >= PRAZO_DIAS` + **SLA explícito** (`SLA_REBAIXAMENTO_MS`, 90 min) em vez de
  hora mágica. Casos de fronteira (dia 4, dia 5, instante exato do devido) travados por teste.
- `OVERDUE_GRACE_DAYS` e `diasDesde` viraram **fonte única** com a régua — o teste que dizia
  guardar o alinhamento só verificava `PRAZO_DIAS === 5` e nunca olhava o `expire-plans`.
- `expire-plans` ganhou **alarme próprio** (era o único cron de billing sem) e **contabilidade
  fechada**: `total === reverted + extended + grace + transient + writeFailed + conflict`. Os dois
  ramos de erro de escrita não incrementavam nada — a resposta JSON mentia por omissão justamente
  quando o banco ficava inconsistente.
- Watchdog: o marcador diário e o contador ficavam **antes** do envio, e o envio era
  `.catch(() => {})`. Agora só conta o que o canal aceitou; falha de entrega **devolve o
  marcador** para a próxima rodada.
- `asaasFetch` ganhou timeout de 10s **em leitura** (GET). Escrita segue sem teto de propósito:
  abortar um POST que cria cobrança é pior que esperar.
- `run-cron.sh` **preserva o exit code** (saía 0 até em HTTP 500) e grava a linha num único
  `printf` (o log saía entrelaçado com jobs concorrentes).

**Agendamento resultante:**
| Quando (BRT) | Quem |
|---|---|
| 00:00–00:59 | cron da Vercel (Hobby: até 59 min de atraso documentado) |
| 01:10 | backstop no crontab da VPS — grava o JSON em `cron.log` |
| 01:30 em diante | watchdog da régua alerta se ainda não rebaixou |

O backstop da VPS **não existe pela redundância de disparo** — existe porque é a única
observabilidade do job no Hobby. Mexer nos horários exige revisar `SLA_REBAIXAMENTO_MS`.

**Quando migrar para o Vercel Pro** (decisão do Sidney: ao fechar 2 assinaturas pagas): compre
pelos **logs de runtime**, que foram o custo real deste episódio — não pela pontualidade. O Pro
não conserta falha transitória silenciosa.
