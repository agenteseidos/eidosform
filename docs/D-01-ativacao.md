# D-01 · Ativação da régua de cobrança

> Código no ar e **inerte até o timer ser ligado**. O canal WhatsApp fica atrás de uma flag,
> aguardando a Meta aprovar os templates (2ª onda).

## Como a régua funciona (resumo operacional)

| Dia | Estágio | Horário | Assunto |
|---|---|---|---|
| D+0 | 0 | 9h | Seu pagamento de hoje não foi aprovado |
| D+1 | 1 | 12h | Faltam 4 dias no seu plano |
| D+2 | 2 | 17h | Faltam 3 dias — depois seus formulários começam a pausar |
| D+3 | 3 | 9h | Em 2 dias você deixa de ser avisado dos seus leads |
| D+4 | 4 | **9h fixo** | Amanhã seus formulários param de receber respostas |
| D+5 | 5 | 9h | Seus formulários foram pausados — reative quando quiser |

**O gatilho de parada:** a régua consulta o gateway A CADA rodada. Quem pagou não tem cobrança
vencida → nenhum aviso sai. Nada é agendado com antecedência, então o pagamento interrompe a
sequência sem ninguém cancelar nada.

**Ordem com o rebaixamento:** o `expire-plans` roda à meia-noite; a régua, de manhã. O aviso
"sua conta voltou ao gratuito" só sai se o rebaixamento REALMENTE aconteceu — se ele falhar, a
régua cala a boca e dispara um **alerta operacional** (o `expire-plans` não tem alarme próprio).

## Passo 1 — ligar o timer (a régua roda de hora em hora)

```ini
# /etc/systemd/system/eidosform-dunning.service
[Unit]
Description=EidosForm - régua de cobrança de inadimplência (D-01)

[Service]
Type=oneshot
User=sidney
ExecStart=/home/sidney/.eidos-credentials/produtos/run-cron.sh dunning
StandardOutput=append:/home/sidney/.eidos-credentials/produtos/cron.log
StandardError=append:/home/sidney/.eidos-credentials/produtos/cron.log
```

```ini
# /etc/systemd/system/eidosform-dunning.timer
[Unit]
Description=Roda a régua de cobrança de hora em hora (ela decide a janela de cada estágio)

[Timer]
OnCalendar=*-*-* *:05:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eidosform-dunning.timer
```

Roda no minuto 5 de cada hora; a rota compara a hora de Brasília com a janela do estágio e só
age na hora certa. `Persistent=true` recupera a rodada se a VPS estiver desligada na virada.

## Passo 2 (2ª onda) — os templates de WhatsApp

Os 6 corpos estão em `lib/dunning-content.ts` (campo `whatsappBody`), já redigidos para
**categoria UTILITY**. Submeter na Meta com os nomes `eidosform_cobranca_d0_v1` … `d5_v1`,
cada um com **1 botão de URL dinâmica** (o link de pagamento) e 2 variáveis: `{{1}}` nome,
`{{2}}` plano.

⚠️ **A armadilha da categoria:** a Meta recategoriza pelo TEXTO, e cobrança tende a cair em
MARKETING (~9× mais caro). Ver a ficha `whatsapp-template-categoria-utility` na memória ANTES de
submeter. Depois do primeiro aprovado, **conferir a categoria que a Meta atribuiu** — se vier
MARKETING, reescrever antes de ligar.

Com os templates aprovados:

```bash
# env na Vercel (produção)
DUNNING_WHATSAPP_ENABLED=true
```

O canal herda TODAS as checagens do motor automaticamente — a decisão de avisar acontece antes
de qualquer canal, por construção.

## Como conferir que está funcionando

```bash
grep dunning /home/sidney/.eidos-credentials/produtos/cron.log | tail -5
# {"ok":true,"horaBRT":14,"candidatos":3,"avisados":0,"silenciados":3,...}
```

Fora das janelas (9h/12h/17h) o esperado é `avisados: 0` com `silenciados` = candidatos.

## Teste manual de uma janela específica

```bash
curl -H "Authorization: Bearer $(cat /home/sidney/.eidos-credentials/produtos/cron-secret)" \
  "https://eidosform.com.br/api/cron/dunning?hora=9"
```

O `?hora=` só muda QUANDO a régua considera estar; todas as checagens continuam valendo, então
nenhum cliente adimplente recebe nada por causa dele.
