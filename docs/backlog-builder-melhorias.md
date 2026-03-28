# Backlog de Melhorias — EidosForm Builder
**Data:** 28/03/2026 | **Fonte:** Análise comparativa com Yay! Forms + feedback do Sidney

---

## 🔴 Alto Impacto (fazer primeiro)

### B01 — Painel direito fixo (Questão + Lógica)
**Descrição:** Painel lateral direito sempre visível com duas abas:
- **Aba Questão:** tipo do campo (dropdown), ID copiável, toggle obrigatório, upload de mídia (imagem/vídeo)
- **Aba Lógica:** lógica condicional, regras de navegação ("Vá para"), variáveis
**Referência:** Yay! Forms — painel direito organizado em abas

### B02 — Destaque visual da questão ativa
**Descrição:** Questão selecionada na sidebar deve ter borda colorida ou fundo highlighted. Atualmente todas as questões têm aparência idêntica.

### B03 — Ícones coloridos por tipo de campo na sidebar
**Descrição:** Cada tipo de campo com ícone e cor própria (ex: azul = Sim/Não, laranja = texto, verde = email). Melhora escaneabilidade do formulário inteiro de relance.

### B04 — Tabs de navegação no centro do header
**Descrição:** Mover navegação principal para o centro do header:
`Editar | Integrar | Compartilhar | Resultados`
Atualmente as tabs estão na sidebar esquerda e ficam truncadas ("Configura...").

### B05 — Edição inline no preview
**Descrição:** Texto da pergunta editável diretamente no preview central, sem precisar de campo separado na sidebar. A pessoa clica na pergunta e digita ali mesmo.

### B06 — Salvamento automático
**Descrição:** Eliminar o botão "Salvar" manual. Salvar automaticamente a cada alteração (debounce de 1-2s). Exibir indicador sutil "Salvo" no header.

### B07 — Integração nativa com Calendly
**Descrição:** Tipo de pergunta "Agendar" com embed do Calendly. Respondente agenda sem sair do form. Alto valor para funnels de vendas e qualificação de leads.
**Formato:** Tipo de campo adicional no menu de "Adicionar Pergunta"

### B08 — Tela de Boas-vindas e Telas Finais na sidebar de conteúdo
**Descrição:** Mover a configuração da tela de boas-vindas e telas finais para a sidebar de conteúdo, não nas configurações. Organizar sidebar em 3 seções:
- `TELA DE BOAS VINDAS`
- `QUESTÕES`
- `TELAS FINAIS` (com "+ Adicionar tela final")

---

## 🟡 Médio Impacto (segunda rodada)

### B09 — Menu "Adicionar Pergunta" categorizado e com ícones
**Descrição:** Menu de tipos de pergunta organizado por categoria com ícones coloridos. Modelo atual é lista simples. Referência: menu do Yay! Forms com categorias Escolhas / Contato / Texto / Arquivo / Estrutura / IA / Integração.

### B10 — Botão Upgrade em destaque no header
**Descrição:** CTA de upgrade visível no header para usuários de planos inferiores. Aumenta conversão para planos pagos.

### B11 — CTA "Publicar" como botão primário isolado
**Descrição:** Separar "Publicar" como botão destacado no canto direito do header (não como status badge). Deixar claro que é uma ação, não apenas um indicador.

### B12 — Seções rotuladas na sidebar
**Descrição:** Labels em CAPS separando as seções da sidebar (modelo já descrito no B08).

### B13 — Preview "uma pergunta por vez"
**Descrição:** Preview central mostrando uma pergunta por vez, refletindo a experiência real do respondente.

### B14 — ID do campo copiável no painel
**Descrição:** ID do campo exposto com botão de cópia com um clique. Útil para webhooks e integrações.

### B15 — Atalhos de teclado visíveis nas opções de resposta
**Descrição:** Exibir atalho de teclado ao lado das opções (ex: S / N para Sim/Não, A / B / C para múltipla escolha).

### B16 — Cores distintas por tipo de campo
**Descrição:** Complemento do B03 — paleta de cores consistente por categoria de campo em toda a UI do builder.

---

## 🟢 Baixo Impacto (polish)

### B17 — Dots de janela no preview central
**Descrição:** 3 dots coloridos (simulando janela de app/browser) no card de preview para deixar claro que é simulação isolada.

### B18 — Corrigir truncamento das tabs
**Descrição:** "Configura..." → "Configurações" ou usar ícone. Problema de viewport intermediário.

### B19 — Botão "+ Adicionar pergunta" inline no final da lista
**Descrição:** Botão adicional inline no final da lista de perguntas, além do botão no topo.

### B20 — Avatar do usuário no header
**Descrição:** Foto/inicial do usuário logado visível no canto superior direito do builder.

---

## 📌 Notas de Produto

- **Calendly:** Tratar como tipo de pergunta nativa (não integração externa nas configurações)
- **Salvamento automático (B06):** Prioridade alta por impacto direto na confiança do usuário
- **Edição inline (B05):** Mudança de paradigma — avaliação de impacto técnico necessária antes
- **Painel direito (B01):** Maior gap atual vs concorrência — estruturar como sprint dedicado

---

*Backlog gerado a partir de análise comparativa com Yay! Forms e feedback direto do Sidney Medeiros em 28/03/2026.*
