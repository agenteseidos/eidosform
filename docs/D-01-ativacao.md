# D-01 · Ativação da régua de cobrança

> Código no ar e **inerte até o timer ser ligado**. O canal WhatsApp fica atrás de uma flag,
> aguardando a Meta aprovar os templates (2ª onda).

## Como a régua funciona (resumo operacional)

⚠️ **Horários são POR CANAL desde 14/08** (dois toques espalhados cobrem mais gente que dois
simultâneos). A tabela abaixo é a fonte da verdade operacional; a fonte no código são as duas
constantes de `lib/dunning-engine.ts`, travadas por teste célula a célula.

| Dia | Estágio | E-mail | WhatsApp | Assunto do e-mail |
|---|---|---|---|---|
| D+0 | 0 | 9h | 15h | Seu pagamento de hoje não foi aprovado |
| D+1 | 1 | 12h | **19h30** | Faltam 4 dias no seu plano |
| D+2 | 2 | **19h30** | 11h | Faltam 3 dias — depois seus formulários começam a pausar |
| D+3 | 3 | 9h | 15h | Em 2 dias você deixa de ser avisado dos seus leads |
| D+4 | 4 | **9h fixo** | 13h | Amanhã seus formulários param de receber respostas |
| D+5 | 5 | 9h | 11h | Seus formulários foram pausados — reative quando quiser |

**Janela civilizada:** piso 8h, teto 19h30. O teto era 18h até 14/08 — caiu porque o argumento
("banco fechado") não vale: Pix e cartão rodam 24h e a página de pagamento é autoatendimento.

**Tolerância de atraso:** cada canal aceita ser executado até 90 min depois da hora dele (ou até
a fatia do outro canal, o que vier antes). Recupera VPS reiniciando ou fila travada; NÃO
ressuscita um aviso das 9h às 18h. O `Persistent=true` do systemd **não** basta sozinho: ele
redispara a execução, mas a rota lê o relógio ATUAL — quem recupera a janela é esta tolerância.

**O gatilho de parada:** a régua consulta o gateway A CADA rodada. Quem pagou não tem cobrança
vencida → nenhum aviso sai. Nada é agendado com antecedência, então o pagamento interrompe a
sequência sem ninguém cancelar nada.

**Ordem com o rebaixamento:** o `expire-plans` roda à meia-noite; a régua, de manhã. O aviso
"sua conta voltou ao gratuito" só sai se o rebaixamento REALMENTE aconteceu — se ele falhar, a
régua cala a boca e dispara um **alerta operacional** (o `expire-plans` não tem alarme próprio).

## Passo 1 — ligar o timer (a régua roda A CADA 30 MIN)

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
Description=Roda a régua de cobrança a cada 30 min (a rota decide a janela de cada estágio/canal)

[Timer]
OnCalendar=*-*-* *:05,35:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eidosform-dunning.timer
```

Roda aos **:05 e :35** de cada hora. Os horários são MINUTOS do dia (`hm(19,30)`) e a rota
compara por **fatia de 30 min** — é isso que faz 19h30 casar com o disparo real das 19h35. Sem
o arredondamento, o turno da noite nasceria mudo.

## Passo 2 (2ª onda) — os templates de WhatsApp

A régua usa somente os 2 templates genéricos UTILITY já mantidos pela Elen:

- `eidosform_cobranca_v1` (D+0 a D+4) e `eidosform_plano_rebaixado_v2` (D+5): os DOIS têm
  `{{1}}` nome, `{{2}}` plano e `{{3}}` a mensagem do dia inteira (técnica {UP}).
- ⚠️ `eidosform_plano_rebaixado_v1` virou **MARKETING** e está morto: nome bloqueado 30 dias,
  nunca reaproveitar. Foi o que motivou o preflight ao vivo.

Os dois têm um botão URL dinâmica `https://eidosform.com.br/pagar/{{1}}`; o envio passa apenas
o token como parâmetro do botão e só tenta o canal quando ainda existe cobrança com link. Os
JSONs canônicos ficam em `eidos-atendente-wpp/campanhas/templates/` e um teste contratual do
EidosForm lê esses arquivos reais para travar nome, categoria e componentes.

⚠️ **A armadilha da categoria:** a Meta recategoriza pelo TEXTO, e cobrança tende a cair em
MARKETING (~9× mais caro). Ver a ficha `whatsapp-template-categoria-utility` na memória ANTES de
submeter. Depois do primeiro aprovado, **conferir a categoria que a Meta atribuiu** — se vier
MARKETING, reescrever antes de ligar.

Com os templates confirmados como UTILITY:

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

Fora das janelas de cada canal (ver tabela acima) o esperado é `avisados: 0` com `silenciados` = candidatos.

## Teste manual de uma janela específica

```bash
curl -H "Authorization: Bearer $(cat /home/sidney/.eidos-credentials/produtos/cron-secret)" \
  "https://eidosform.com.br/api/cron/dunning?hora=9"
```

O `?hora=` só muda QUANDO a régua considera estar; todas as checagens continuam valendo, então
nenhum cliente adimplente recebe nada por causa dele.
