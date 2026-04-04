export interface TemplateQuestion {
  id: string
  type: 'short_text' | 'long_text' | 'multiple_choice' | 'rating' | 'email' | 'number' | 'yes_no'
  title: string
  description?: string
  required: boolean
  options?: string[]
  min?: number
  max?: number
}

export interface FormTemplate {
  id: string
  name: string
  description: string
  category: string
  emoji: string
  theme: {
    primaryColor: string
    backgroundColor: string
    fontFamily: string
  }
  questions: TemplateQuestion[]
}

export const templates: FormTemplate[] = [
  {
    id: 'lead-capture',
    name: 'Captura de Leads',
    description: 'Colete informações de potenciais clientes de forma elegante',
    category: 'Marketing',
    emoji: '🎯',
    theme: { primaryColor: '#3B82F6', backgroundColor: '#EFF6FF', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Qual é o seu nome completo?', required: true },
      { id: 'q2', type: 'email', title: 'Qual é o seu melhor e-mail?', required: true },
      { id: 'q3', type: 'short_text', title: 'Qual é o nome da sua empresa?', required: false },
      { id: 'q4', type: 'multiple_choice', title: 'Qual é o seu cargo?', required: true, options: ['CEO/Fundador', 'Gerente', 'Analista', 'Desenvolvedor', 'Outro'] },
      { id: 'q5', type: 'multiple_choice', title: 'Qual é o tamanho da sua empresa?', required: false, options: ['1-10 funcionários', '11-50', '51-200', '201-1000', '+1000'] },
      { id: 'q6', type: 'long_text', title: 'Como podemos te ajudar?', required: false },
    ],
  },
  {
    id: 'nps',
    name: 'NPS — Net Promoter Score',
    description: 'Meça a lealdade dos seus clientes com a pesquisa NPS padrão',
    category: 'Feedback',
    emoji: '⭐',
    theme: { primaryColor: '#8B5CF6', backgroundColor: '#F5F3FF', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'rating', title: 'Em uma escala de 0 a 10, o quanto você recomendaria nossa empresa para um amigo ou colega?', required: true, min: 0, max: 10 },
      { id: 'q2', type: 'long_text', title: 'Qual é o principal motivo da sua nota?', required: false },
      { id: 'q3', type: 'multiple_choice', title: 'Como você nos conheceu?', required: false, options: ['Indicação', 'Redes sociais', 'Google', 'Evento', 'Outro'] },
    ],
  },
  {
    id: 'orcamento',
    name: 'Solicitação de Orçamento',
    description: 'Qualifique e colete pedidos de orçamento dos seus clientes',
    category: 'Vendas',
    emoji: '💰',
    theme: { primaryColor: '#10B981', backgroundColor: '#ECFDF5', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Qual é o seu nome?', required: true },
      { id: 'q2', type: 'email', title: 'E-mail para contato', required: true },
      { id: 'q3', type: 'short_text', title: 'Telefone / WhatsApp', required: false },
      { id: 'q4', type: 'short_text', title: 'Nome da empresa', required: false },
      { id: 'q5', type: 'multiple_choice', title: 'Qual serviço você precisa?', required: true, options: ['Desenvolvimento Web', 'Design Gráfico', 'Marketing Digital', 'Consultoria', 'Outro'] },
      { id: 'q6', type: 'long_text', title: 'Descreva o seu projeto ou necessidade', required: true },
      { id: 'q7', type: 'multiple_choice', title: 'Qual é o seu orçamento estimado?', required: false, options: ['Até R$1.000', 'R$1.000 – R$5.000', 'R$5.000 – R$20.000', 'Acima de R$20.000'] },
      { id: 'q8', type: 'multiple_choice', title: 'Qual é o prazo ideal para início?', required: false, options: ['Imediato', 'Em 1 mês', 'Em 3 meses', 'Sem pressa'] },
    ],
  },
  {
    id: 'evento',
    name: 'Inscrição para Evento',
    description: 'Gerencie inscrições para workshops, webinars e eventos presenciais',
    category: 'Eventos',
    emoji: '🎪',
    theme: { primaryColor: '#F59E0B', backgroundColor: '#FFFBEB', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Qual é o seu nome completo?', required: true },
      { id: 'q2', type: 'email', title: 'E-mail para confirmação', required: true },
      { id: 'q3', type: 'short_text', title: 'Telefone / WhatsApp', required: false },
      { id: 'q4', type: 'multiple_choice', title: 'Como você ficou sabendo do evento?', required: false, options: ['Redes sociais', 'E-mail marketing', 'Amigo', 'Site', 'Outro'] },
      { id: 'q5', type: 'yes_no', title: 'Você tem alguma restrição alimentar?', required: false },
      { id: 'q6', type: 'long_text', title: 'Tem alguma dúvida ou comentário?', required: false },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback de Produto',
    description: 'Colete feedback valioso sobre seu produto ou serviço',
    category: 'Feedback',
    emoji: '💬',
    theme: { primaryColor: '#EF4444', backgroundColor: '#FEF2F2', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'rating', title: 'Como você avalia nossa solução no geral?', required: true, min: 1, max: 5 },
      { id: 'q2', type: 'multiple_choice', title: 'Qual funcionalidade você mais usa?', required: false, options: ['Criação de formulários', 'Análise de respostas', 'Integrações', 'Templates', 'Outra'] },
      { id: 'q3', type: 'long_text', title: 'O que mais te agrada na plataforma?', required: false },
      { id: 'q4', type: 'long_text', title: 'O que poderíamos melhorar?', required: false },
      { id: 'q5', type: 'yes_no', title: 'Você recomendaria nossa solução para colegas?', required: true },
    ],
  },
  {
    id: 'qualificacao-b2b',
    name: 'Qualificação B2B',
    description: 'Qualifique leads corporativos antes de uma reunião de vendas',
    category: 'Vendas',
    emoji: '🏢',
    theme: { primaryColor: '#1D4ED8', backgroundColor: '#EFF6FF', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Seu nome e cargo', required: true },
      { id: 'q2', type: 'email', title: 'E-mail corporativo', required: true },
      { id: 'q3', type: 'short_text', title: 'Nome da empresa', required: true },
      { id: 'q4', type: 'short_text', title: 'Site da empresa', required: false },
      { id: 'q5', type: 'multiple_choice', title: 'Segmento de atuação', required: true, options: ['Tecnologia', 'Varejo', 'Saúde', 'Educação', 'Financeiro', 'Indústria', 'Outro'] },
      { id: 'q6', type: 'multiple_choice', title: 'Quantos funcionários tem a empresa?', required: true, options: ['1–10', '11–50', '51–200', '201–1000', '+1000'] },
      { id: 'q7', type: 'multiple_choice', title: 'Qual é o seu principal desafio hoje?', required: true, options: ['Gerar mais leads', 'Reter clientes', 'Aumentar conversão', 'Reduzir custos', 'Escalar time', 'Outro'] },
      { id: 'q8', type: 'multiple_choice', title: 'Qual é o budget mensal disponível?', required: false, options: ['Até R$2.000', 'R$2.000–R$10.000', 'R$10.000–R$50.000', 'Acima de R$50.000'] },
    ],
  },
  {
    id: 'pesquisa-mercado',
    name: 'Pesquisa de Mercado',
    description: 'Valide ideias e entenda melhor o seu mercado-alvo',
    category: 'Pesquisa',
    emoji: '📊',
    theme: { primaryColor: '#0891B2', backgroundColor: '#ECFEFF', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'multiple_choice', title: 'Qual é a sua faixa etária?', required: true, options: ['18–24', '25–34', '35–44', '45–54', '55+'] },
      { id: 'q2', type: 'multiple_choice', title: 'Qual é a sua renda mensal aproximada?', required: false, options: ['Até R$2.000', 'R$2.000–R$5.000', 'R$5.000–R$10.000', 'Acima de R$10.000'] },
      { id: 'q3', type: 'multiple_choice', title: 'Você já usou alguma solução similar?', required: true, options: ['Sim, frequentemente', 'Sim, raramente', 'Não, mas conheço', 'Não conheço'] },
      { id: 'q4', type: 'rating', title: 'Qual a sua disposição em pagar por uma solução que resolva esse problema?', required: true, min: 1, max: 10 },
      { id: 'q5', type: 'long_text', title: 'Descreva como você lida com esse problema hoje', required: false },
      { id: 'q6', type: 'long_text', title: 'Qual funcionalidade seria indispensável para você?', required: false },
    ],
  },
  {
    id: 'contato',
    name: 'Formulário de Contato',
    description: 'Formulário simples e elegante para página de contato',
    category: 'Geral',
    emoji: '✉️',
    theme: { primaryColor: '#6366F1', backgroundColor: '#EEF2FF', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Seu nome', required: true },
      { id: 'q2', type: 'email', title: 'Seu e-mail', required: true },
      { id: 'q3', type: 'short_text', title: 'Assunto', required: true },
      { id: 'q4', type: 'long_text', title: 'Mensagem', required: true },
    ],
  },
  {
    id: 'quiz',
    name: 'Quiz Interativo',
    description: 'Engaje seu público com um quiz divertido e revelador',
    category: 'Engajamento',
    emoji: '🧠',
    theme: { primaryColor: '#7C3AED', backgroundColor: '#F5F3FF', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Qual é o seu nome?', required: true },
      { id: 'q2', type: 'multiple_choice', title: 'Quando você pensa em produtividade, qual palavra vem à mente?', required: true, options: ['Foco', 'Energia', 'Organização', 'Motivação'] },
      { id: 'q3', type: 'multiple_choice', title: 'Qual é o seu maior desafio no trabalho?', required: true, options: ['Priorizar tarefas', 'Evitar distrações', 'Comunicação', 'Gestão de tempo'] },
      { id: 'q4', type: 'multiple_choice', title: 'Como você prefere aprender?', required: true, options: ['Vídeos', 'Lendo artigos', 'Podcast', 'Prática'] },
      { id: 'q5', type: 'multiple_choice', title: 'Qual ferramenta você não vive sem?', required: true, options: ['Notion', 'Trello', 'Planilha', 'Papel e caneta'] },
      { id: 'q6', type: 'email', title: 'Deixe seu e-mail para receber o resultado', required: true },
    ],
  },
  {
    id: 'agencia-trafego-captura',
    name: 'Agência de Tráfego: Captura',
    description: 'Formulário de captura de leads otimizado para campanhas de tráfego pago — rápido, direto e focado em conversão',
    category: 'Agência',
    emoji: '🚦',
    theme: { primaryColor: '#F97316', backgroundColor: '#FFF7ED', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Qual é o seu nome?', required: true },
      { id: 'q2', type: 'short_text', title: 'Qual é o seu WhatsApp?', required: true },
      { id: 'q3', type: 'email', title: 'Qual é o seu melhor e-mail?', required: false },
      { id: 'q4', type: 'multiple_choice', title: 'Qual é o seu maior desafio hoje?', required: true, options: ['Gerar mais leads', 'Aumentar vendas', 'Reduzir custo por lead', 'Melhorar taxa de conversão', 'Outro'] },
      { id: 'q5', type: 'multiple_choice', title: 'Qual é o seu orçamento mensal em tráfego pago?', required: false, options: ['Até R$1.000', 'R$1.000–R$5.000', 'R$5.000–R$20.000', 'Acima de R$20.000'] },
      { id: 'q6', type: 'multiple_choice', title: 'Você já investe em tráfego pago hoje?', required: true, options: ['Sim, no Meta Ads', 'Sim, no Google Ads', 'Sim, em ambos', 'Ainda não'] },
      { id: 'q7', type: 'short_text', title: 'Qual é o nome do seu negócio ou produto?', required: false },
    ],
  },
  {
    id: 'briefing-agencia',
    name: 'Briefing para Agência',
    description: 'Colete todas as informações para iniciar um projeto criativo',
    category: 'Agência',
    emoji: '🎨',
    theme: { primaryColor: '#EC4899', backgroundColor: '#FDF2F8', fontFamily: 'inter' },
    questions: [
      { id: 'q1', type: 'short_text', title: 'Nome da empresa / marca', required: true },
      { id: 'q2', type: 'short_text', title: 'Responsável pelo projeto', required: true },
      { id: 'q3', type: 'email', title: 'E-mail de contato', required: true },
      { id: 'q4', type: 'long_text', title: 'Descreva o seu negócio e o que você faz', required: true },
      { id: 'q5', type: 'long_text', title: 'Quem é o seu público-alvo?', required: true },
      { id: 'q6', type: 'multiple_choice', title: 'Qual é o tipo de projeto?', required: true, options: ['Identidade visual', 'Site / Landing page', 'Campanha de marketing', 'Conteúdo para redes sociais', 'Vídeo', 'Outro'] },
      { id: 'q7', type: 'long_text', title: 'Quais são os objetivos deste projeto?', required: true },
      { id: 'q8', type: 'long_text', title: 'Cite referências visuais ou de marcas que você admira', required: false },
      { id: 'q9', type: 'multiple_choice', title: 'Qual é o prazo esperado de entrega?', required: false, options: ['1 semana', '2 semanas', '1 mês', '2 meses', 'Flexível'] },
      { id: 'q10', type: 'multiple_choice', title: 'Qual é o orçamento disponível?', required: false, options: ['Até R$2.000', 'R$2.000–R$5.000', 'R$5.000–R$15.000', 'Acima de R$15.000'] },
    ],
  },
]
