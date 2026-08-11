# D-05 · Ativação da fila de reenvio de e-mail

> Código no ar desde 11/08/2026 e **inofensivo enquanto a tabela não existir** (no-op silencioso,
> mesmo contrato do `email_deliveries`). Dois passos para ligar.

## Passo 1 — a tabela (SQL Editor do Supabase)

Cole o conteúdo de `supabase/migrations/20260811_email_retry_queue.sql`. Ele já inclui o registro
no rastreamento criado no D-03 — a regra nova: **toda mudança de banco deixa rastro na mesma
execução**.

O Supabase pode avisar "tabela sem RLS": o script **já habilita RLS** e revoga anon/authenticated;
se aparecer o aviso, escolher **"Run and enable RLS"** (a opção verde) é seguro e redundante.

Verificação (deve devolver a tabela vazia, sem erro):

```sql
select * from public.email_retry_queue limit 5;
select version, name, applied_at from supabase_migrations.schema_migrations order by applied_at desc;
```

## Passo 2 — o dreno (timer na VPS, feito pelo Claude)

O endpoint é `/api/cron/email-retry`, protegido pelo `CRON_SECRET`, no mesmo padrão dos outros.
Roda a cada 5 minutos — mais frequente que os de billing porque a primeira tentativa da fila é em
5 min, e um dreno lento desperdiçaria a janela curta.

Unidades a criar (espelham `eidosform-abandoned-email.*`, que já usa o `run-cron.sh`):

```ini
# /etc/systemd/system/eidosform-email-retry.service
[Unit]
Description=EidosForm - dreno da fila de reenvio de e-mail (D-05)

[Service]
Type=oneshot
User=sidney
ExecStart=/home/sidney/.eidos-credentials/produtos/run-cron.sh email-retry
StandardOutput=append:/home/sidney/.eidos-credentials/produtos/cron.log
StandardError=append:/home/sidney/.eidos-credentials/produtos/cron.log
```

```ini
# /etc/systemd/system/eidosform-email-retry.timer
[Unit]
Description=Drena a fila de reenvio de e-mail a cada 5 min

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eidosform-email-retry.timer
systemctl list-timers | grep email-retry
```

## Como saber que está funcionando

- `grep email-retry /home/sidney/.eidos-credentials/produtos/cron.log | tail -5` → devolve
  `{"ok":true,"total":0,...}` nas rodadas sem trabalho;
- com fila vazia o dreno não faz nenhuma consulta pesada — `total: 0` e sai;
- item que esgota as 48h manda **WhatsApp** para o número do dono (`ADMIN_ALERT_WHATSAPP`).

## Como testar de verdade (opcional, quando quiser)

Não há como derrubar a Resend de propósito. O caminho honesto é: quebrar a `RESEND_API_KEY` num
**preview** da Vercel, enviar um lead de teste, ver a linha nascer em `email_retry_queue`,
restaurar a chave e observar o dreno entregar na próxima rodada.
