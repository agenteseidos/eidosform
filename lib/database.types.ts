import { JumpRule } from "@/lib/jump-logic"
import { PixelEventRule, AnswerSetEvent } from "@/types/pixel-events"
import { PlanId } from "@/lib/plans"

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Question types supported by the form builder
export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'dropdown'
  | 'select'
  | 'checkboxes'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'rating'
  | 'opinion_scale'
  | 'yes_no'
  | 'file_upload'
  | 'nps'
  | 'url'
  | 'address'
  | 'cpf'
  | 'calendly'
  | 'html_block'
  | 'content_block'

// Conditional logic operators
export type ConditionalOperator = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'not_empty' | 'is_empty'

// Conditional logic rule
export interface ConditionalRule {
  questionId: string
  operator: ConditionalOperator
  value?: string
}

// Conjunção entre múltiplas regras de visibilidade
export type ConditionalConjunction = 'and' | 'or'

// Grupo de regras de visibilidade (formato novo). O formato legado é uma
// ConditionalRule única; normalizeConditional() converte os dois para grupo.
export interface ConditionalGroup {
  conjunction: ConditionalConjunction
  rules: ConditionalRule[]
}

// Form status
export type FormStatus = 'draft' | 'published' | 'closed'

// Plan tiers — single source of truth em lib/plans.ts
export type PlanType = PlanId

// Theme presets
export type ThemePreset = 
  | 'midnight'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'lavender'
  | 'minimal'
  | 'terracota'
  | 'onix'
  | 'areia'

export interface ThemeConfig {
  id: ThemePreset
  name: string
  primaryColor: string
  backgroundColor: string
  textColor: string
  accentColor: string
  fontFamily: string
}

export interface Folder {
  id: string
  name: string
  user_id: string
  created_at: string
  updated_at?: string
}

// Question configuration
export interface QuestionConfig {
  id: string
  type: QuestionType
  title: string
  description?: string
  required: boolean
  // Type-specific options
  options?: string[] // For dropdown, select and checkboxes
  allowOther?: boolean // For dropdown, select and checkboxes: adds a native "Outro" option with a free-text box
  minValue?: number // For rating (1-5 stars) or opinion_scale (1-10)
  maxValue?: number
  allowedFileTypes?: string[] // For file_upload
  maxFileSize?: number // In MB
  placeholder?: string
  defaultCountry?: string // Country code for phone type (default: BR)
  calendlyUrl?: string // Calendly embed URL for calendly type
  htmlContent?: string // HTML for html_block — sanitizado (allowlist de iframes) em sanitizeContentBlocksServer na escrita e no render
  htmlBlockNote?: string // Optional rich-text instruction shown below the iframe in html_block (e.g. "After scheduling, click Send")
  conditionalLogic?: ConditionalRule | ConditionalGroup // legado (objeto) ou novo (grupo)
  pixelEvents?: PixelEventRule[]
  jumpRules?: JumpRule[]
  // Content block fields
  contentBody?: string
  contentButtonText?: string
  contentButtonUrl?: string
}

// Pixel tracking configuration
export interface PixelConfig {
  metaPixelId?: string       // Meta (Facebook) Pixel ID
  googleAdsId?: string       // Google Ads Conversion ID (AW-XXXXXXXXX)
  googleAdsLabel?: string    // Google Ads Conversion Label
  tiktokPixelId?: string     // TikTok Pixel ID
  gtmId?: string             // Google Tag Manager Container ID (GTM-XXXXXXX)
  answerSetEvents?: AnswerSetEvent[] // Eventos por conjunto de respostas (máx. 10 por form)
  /**
   * Código de teste do Gerenciador de Eventos (Meta), TEMPORÁRIO — a única forma de conferir que
   * o envio pelo servidor está chegando. Não é segredo: é descartável e inútil sem o token.
   * Por isso pode morar aqui, em `pixels`, que viaja para o navegador do visitante — ao contrário
   * do token, que fica cifrado em `form_capi_credentials`.
   */
  metaTestEventCode?: string
  /** Quando o código foi colado. É isto que o faz EXPIRAR sozinho (3h) — ver `codigoDeTesteValido`. */
  metaTestEventCodeAt?: string
}

// Database tables
export interface Database {
  public: {
    Views: {
      [_ in never]: never
    }
    Functions: {
      // Canonicalização BR do telefone — a MESMA regra da coluna gerada profiles.phone_match_key_br.
      // Usar esta função (e não o toWhatsAppDigits do TS) é obrigatório para casar listas com
      // contas: o TS devolve 13 dígitos (com o nono dígito) e a coluna gerada devolve 12.
      canonical_phone_match_key_br: {
        Args: { raw_phone: string }
        Returns: string
      }
      reserve_trial_signup: {
        Args: { p_codigo: string; p_email_hash: string; p_phone_key: string }
        Returns: Json
      }
      trial_signup_bind: {
        Args: { p_intent_id: string; p_user_id: string }
        Returns: Json
      }
      grant_trial: {
        Args: { p_profile_id: string; p_owner_token: string }
        Returns: Json
      }
      lapse_trials_vencidos: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      generate_api_key: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      increment_response_count: {
        Args: { p_user_id: string }
        Returns: void
      }
      increment_responses_used: {
        Args: { p_user_id: string }
        Returns: void
      }
      check_rate_limit: {
        Args: { p_key: string; p_window_ms: number; p_max_requests: number }
        Returns: Array<{ allowed: boolean; current_count: number; reset_in_ms: number }>
      }
      // Promove a resposta E enfileira os eventos de CAPI na MESMA transação
      // (migrations 20260818_capi_outbox + _parciais). Execute só via service_role.
      promover_resposta_e_enfileirar_capi: {
        Args: {
          p_response_id: string
          p_form_id: string
          p_answers: Json
          p_meta_events: string[]
          p_completed: boolean
          p_last_question: string | null
          p_utm_source: string | null
          p_utm_medium: string | null
          p_utm_campaign: string | null
          p_utm_term: string | null
          p_utm_content: string | null
          p_url_params: Json | null
          p_eventos: Json
        }
        Returns: Json
      }
      check_and_increment_response: {
        Args: { p_user_id: string; p_response_id: string }
        Returns: {
          allowed: boolean
          usage: number
          limit_val: number
          plan: PlanId
          near_limit: boolean
          already_counted: boolean
        }
      }
      resolve_public_custom_domain: {
        Args: { p_hostname: string }
        Returns: Array<{ slug: string }>
      }
      refresh_response_quota_period: {
        Args: { p_user_id: string }
        Returns: Array<{
          usage: number
          limit_val: number
          period_start_at: string
          period_end_at: string
        }>
      }
      get_response_counts_by_forms: {
        Args: { p_form_ids: string[] }
        Returns: Array<{ form_id: string; response_count: number }>
      }
    }
    Enums: {
      form_status: 'draft' | 'published' | 'closed'
      theme_preset: 'midnight' | 'ocean' | 'sunset' | 'forest' | 'lavender' | 'minimal'
    }
    Tables: {
      admin_actions: {
        Row: {
          id: string
          idempotency_key: string | null
          actor_id: string
          actor_email: string
          target_user_id: string
          target_email: string | null
          action: string
          reason: string
          state: string
          before: Json | null
          after: Json | null
          subscription_id: string | null
          payment_id: string | null
          attempts: number
          error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          idempotency_key?: string | null
          actor_id: string
          actor_email: string
          target_user_id: string
          target_email?: string | null
          action: string
          reason: string
          state?: string
          before?: Json | null
          after?: Json | null
          subscription_id?: string | null
          payment_id?: string | null
          attempts?: number
          error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          state?: string
          after?: Json | null
          attempts?: number
          error?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          email_confirmed_at: string | null
          avatar_url: string | null
          plan: PlanId
          api_key: string | null
          api_key_created_at: string | null
          response_count: number
          responses_used: number
          responses_limit: number
          response_period_start_at: string
          response_period_end_at: string
          lifetime_access: boolean
          limit_alert_sent: boolean
          plan_status: string | null
          plan_expires_at: string | null
          annual_started_at: string | null
          proration_basis_days: number | null
          billing_period_start_on: string | null
          billing_period_end_on: string | null
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          // ⚠️ COLUNAS QUE EXISTEM NO BANCO E FALTAVAM AQUI (Regra nº 1, caso 6 — 25/08/2026).
          // Conferidas no OpenAPI do PostgREST de PRODUÇÃO. A ausência fazia o tsc recusar um
          // `.select()` de coluna REAL — o arquivo de tipos é gerado do repo e mente junto.
          downgraded_at: string | null
          overdue_subscription_id: string | null
          previous_plan: string | null
          previous_plan_cycle: string | null
          plan_cycle: string | null
          phone: string | null
          phone_match_key_br: string | null
          cpf_cnpj: string | null
          address: string | null
          address_number: string | null
          postal_code: string | null
          province: string | null
          city: string | null
          state: string | null
          complement: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          email_confirmed_at?: string | null
          avatar_url?: string | null
          plan?: PlanId
          api_key?: string | null
          api_key_created_at?: string | null
          response_count?: number
          responses_used?: number
          responses_limit?: number
          response_period_start_at?: string
          response_period_end_at?: string
          lifetime_access?: boolean
          limit_alert_sent?: boolean
          plan_status?: string | null
          plan_expires_at?: string | null
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          downgraded_at?: string | null
          overdue_subscription_id?: string | null
          previous_plan?: string | null
          previous_plan_cycle?: string | null
          plan_cycle?: string | null
          phone?: string | null
          phone_match_key_br?: never
          cpf_cnpj?: string | null
          address?: string | null
          address_number?: string | null
          postal_code?: string | null
          province?: string | null
          city?: string | null
          state?: string | null
          complement?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          email_confirmed_at?: string | null
          avatar_url?: string | null
          plan?: PlanId
          api_key?: string | null
          api_key_created_at?: string | null
          response_count?: number
          responses_used?: number
          responses_limit?: number
          response_period_start_at?: string
          response_period_end_at?: string
          lifetime_access?: boolean
          limit_alert_sent?: boolean
          plan_status?: string | null
          plan_expires_at?: string | null
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          downgraded_at?: string | null
          overdue_subscription_id?: string | null
          previous_plan?: string | null
          previous_plan_cycle?: string | null
          plan_cycle?: string | null
          phone?: string | null
          phone_match_key_br?: never
          cpf_cnpj?: string | null
          address?: string | null
          address_number?: string | null
          postal_code?: string | null
          province?: string | null
          city?: string | null
          state?: string | null
          complement?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      billing_checkouts: {
        Row: {
          id: string
          profile_id: string
          checkout_id: string
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          asaas_payment_id: string | null
          planchange_attempt_id: string | null
          billing_phone_match_key_br: string | null
          // Discriminador do fluxo (migration 20260422_payment_method_column): billingType do
          // webhook ou 'plan_switch_token'/'plan_switch_fallback' nas trocas de plano.
          payment_method: string | null
          plan: string
          cycle: string
          status: string
          last_event: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          checkout_id: string
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          asaas_payment_id?: string | null
          planchange_attempt_id?: string | null
          billing_phone_match_key_br?: string | null
          payment_method?: string | null
          plan: string
          cycle: string
          status?: string
          last_event?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          checkout_id?: string
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          asaas_payment_id?: string | null
          planchange_attempt_id?: string | null
          billing_phone_match_key_br?: string | null
          payment_method?: string | null
          plan?: string
          cycle?: string
          status?: string
          last_event?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_domains: {
        Row: {
          id: string
          user_id: string
          form_id: string | null
          domain: string
          verified: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          form_id?: string | null
          domain: string
          verified?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          form_id?: string | null
          verified?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      folders: {
        Row: {
          id: string
          user_id: string
          name: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      form_whatsapp_settings: {
        Row: {
          id: string
          form_id: string
          enabled: boolean
          owner_phone: string
          message_template: string
          instance_name: string
          rate_limit_per_hour: number
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          form_id: string
          enabled?: boolean
          owner_phone: string
          message_template?: string
          instance_name?: string
          rate_limit_per_hour?: number
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          form_id?: string
          enabled?: boolean
          owner_phone?: string
          message_template?: string
          instance_name?: string
          rate_limit_per_hour?: number
          created_at?: string
          updated_at?: string
          created_by?: string
        }
        Relationships: []
      }
      forms: {
        Row: {
          file_access_mode: 'owner_only' | 'link'
          file_access_version: number
          id: string
          user_id: string
          folder_id: string | null
          title: string
          description: string | null
          slug: string
          status: FormStatus
          is_public: boolean
          is_published: boolean
          theme: ThemePreset
          questions: QuestionConfig[]
          thank_you_enabled: boolean
          thank_you_message: string
          thank_you_title: string | null
          thank_you_description: string | null
          thank_you_button_text: string | null
          thank_you_button_url: string | null
          pixels: PixelConfig | null
          plan: PlanType
          redirect_url: string | null
          redirect_delay: number | null
          webhook_url: string | null
          pixel_event_on_start: string | null
          pixel_event_on_complete: string | null
          welcome_enabled: boolean
          welcome_title: string | null
          welcome_description: string | null
          welcome_button_text: string | null
          welcome_image_url: string | null
          is_closed: boolean
          paused: boolean
          hide_branding: boolean
          notify_email_enabled: boolean
          notify_owner_enabled?: boolean | null
          notify_email: string | null
          notify_whatsapp_enabled: boolean
          notify_whatsapp_number: string | null
          google_sheets_enabled: boolean
          google_sheets_id: string | null
          google_sheets_share_email: string | null
          version: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          folder_id?: string | null
          title: string
          description?: string | null
          slug: string
          status?: FormStatus
          is_public?: boolean
          is_published?: boolean
          theme?: ThemePreset
          questions?: QuestionConfig[]
          thank_you_enabled?: boolean
          thank_you_message?: string
          thank_you_title?: string | null
          thank_you_description?: string | null
          thank_you_button_text?: string | null
          thank_you_button_url?: string | null
          pixels?: PixelConfig | null
          plan?: PlanType
          redirect_url?: string | null
          redirect_delay?: number | null
          webhook_url?: string | null
          created_at?: string
          pixel_event_on_start?: string | null
          pixel_event_on_complete?: string | null
          welcome_enabled?: boolean
          welcome_title?: string | null
          welcome_description?: string | null
          welcome_button_text?: string | null
          welcome_image_url?: string | null
          is_closed?: boolean
          paused?: boolean
          hide_branding?: boolean
          notify_email_enabled?: boolean
          notify_owner_enabled?: boolean | null
          notify_email?: string | null
          notify_whatsapp_enabled?: boolean
          notify_whatsapp_number?: string | null
          google_sheets_enabled?: boolean
          google_sheets_id?: string | null
          google_sheets_share_email?: string | null
          version?: number
          updated_at?: string
        }
        Update: {
          folder_id?: string | null
          title?: string
          description?: string | null
          slug?: string
          status?: FormStatus
          is_public?: boolean
          is_published?: boolean
          theme?: ThemePreset
          questions?: QuestionConfig[]
          thank_you_enabled?: boolean
          thank_you_message?: string
          thank_you_title?: string | null
          thank_you_description?: string | null
          thank_you_button_text?: string | null
          thank_you_button_url?: string | null
          pixels?: PixelConfig | null
          plan?: PlanType
          redirect_url?: string | null
          redirect_delay?: number | null
          webhook_url?: string | null
          updated_at?: string
          pixel_event_on_start?: string | null
          pixel_event_on_complete?: string | null
          welcome_enabled?: boolean
          welcome_title?: string | null
          welcome_description?: string | null
          welcome_button_text?: string | null
          welcome_image_url?: string | null
          is_closed?: boolean
          paused?: boolean
          hide_branding?: boolean
          notify_email_enabled?: boolean
          notify_owner_enabled?: boolean | null
          notify_email?: string | null
          notify_whatsapp_enabled?: boolean
          notify_whatsapp_number?: string | null
          google_sheets_enabled?: boolean
          google_sheets_id?: string | null
          google_sheets_share_email?: string | null
          version?: number
        }
        Relationships: []
      }
      responses: {
        Row: {
          id: string
          form_id: string
          respondent_id: string | null
          answers: Record<string, Json>
          meta_events: string[]
          completed: boolean
          last_question_answered: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_term: string | null
          utm_content: string | null
          url_params: Record<string, string> | null
          sheets_row_index: number | null
          partial_session_hash: string | null
          partial_revision: number | null
          quota_counted_at: string | null
          submitted_at: string
          // ⚠️ created_at/updated_at NÃO EXISTEM na tabela real (auditoria
          // Codex 2026-07-23, erro 42703 ao consultar) — este arquivo de tipos
          // está desatualizado nesse ponto; pendência de regenerar via CLI
          // do Supabase contra o schema real. Mantido aqui só pra não quebrar
          // call-sites que talvez já assumam esse shape incorreto.
          created_at: string
          updated_at: string
          // Coluna REAL, criada 2026-07-23 (migration manual
          // supabase/migrations-manual/2026-07-23-notificacoes-whatsapp.sql),
          // batida a cada autosave parcial — relógio do cron de lead abandonado.
          last_activity_at: string
        }
        Insert: {
          id?: string
          form_id: string
          respondent_id?: string | null
          answers: Record<string, Json>
          meta_events?: string[]
          completed?: boolean
          last_question_answered?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          url_params?: Record<string, string> | null
          sheets_row_index?: number | null
          partial_session_hash?: string | null
          partial_revision?: number | null
          quota_counted_at?: string | null
          submitted_at?: string
          created_at?: string
          updated_at?: string
          last_activity_at?: string
        }
        Update: {
          respondent_id?: string | null
          answers?: Record<string, Json>
          meta_events?: string[]
          completed?: boolean
          last_question_answered?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_term?: string | null
          utm_content?: string | null
          url_params?: Record<string, string> | null
          sheets_row_index?: number | null
          partial_session_hash?: string | null
          partial_revision?: number | null
          quota_counted_at?: string | null
          updated_at?: string
          last_activity_at?: string
        }
        Relationships: []
      }
      form_files: {
        // Anexo como ENTIDADE (migration 20260816_form_files). Cada acesso via /arquivo resolve
        // o estado ATUAL — o link nunca carrega dono, caminho nem modo.
        Row: {
          id: string
          form_id: string
          question_id: string | null
          response_id: string | null
          object_path: string
          original_name: string | null
          declared_mime: string | null
          size_bytes: number | null
          status: 'pending' | 'ready' | 'claimed' | 'deleted'
          revoked_at: string | null
          expires_at: string | null
          created_at: string
          claimed_at: string | null
        }
        Insert: {
          id?: string
          form_id: string
          question_id?: string | null
          response_id?: string | null
          object_path: string
          original_name?: string | null
          declared_mime?: string | null
          size_bytes?: number | null
          status?: 'pending' | 'ready' | 'claimed' | 'deleted'
          revoked_at?: string | null
          expires_at?: string | null
          created_at?: string
          claimed_at?: string | null
        }
        Update: {
          question_id?: string | null
          response_id?: string | null
          original_name?: string | null
          status?: 'pending' | 'ready' | 'claimed' | 'deleted'
          revoked_at?: string | null
          expires_at?: string | null
          claimed_at?: string | null
        }
        Relationships: []
      }
      contact_channel_state: {
        // A FICHA do contato por telefone (migration 20260820_contact_channel_state).
        // Elen escreve a cada inbound/opt-out; follow-up e régua leem antes de disparar.
        Row: {
          phone: string
          last_inbound_at: string | null
          opted_out: boolean
          opted_out_at: string | null
          updated_at: string
        }
        Insert: {
          phone: string
          last_inbound_at?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          updated_at?: string
        }
        Update: {
          last_inbound_at?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      // ─────────────────────────────────────────────────────────────────────────────
      // TRIAL de 30 dias (migrations 20260828_trial_02..04). O plano `trial` entrega os
      // direitos do Plus mas NÃO existe comercialmente: a identidade dele mora aqui,
      // não em profiles.plan sozinho. Escrita só por service role (RLS sem policy).
      // ─────────────────────────────────────────────────────────────────────────────
      trial_campaigns: {
        Row: {
          id: string
          nome: string
          codigo: string
          codigo_anterior: string | null
          valido_ate: string
          duration_days: number
          confirm_hours: number
          exige_lista: boolean
          teto: number | null
          reservas: number
          ativa: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          nome: string
          codigo: string
          valido_ate: string
          duration_days?: number
          confirm_hours?: number
          exige_lista?: boolean
          teto?: number | null
        }
        Update: {
          codigo?: string
          codigo_anterior?: string | null
          valido_ate?: string
          ativa?: boolean
          teto?: number | null
          reservas?: number
        }
        Relationships: []
      }
      trial_whitelist: {
        Row: {
          campaign_id: string
          phone_match_key_br: string
          nome: string | null
          imported_at: string
        }
        Insert: {
          campaign_id: string
          phone_match_key_br: string
          nome?: string | null
        }
        Update: { nome?: string | null }
        Relationships: []
      }
      trial_signup_intents: {
        // Evidência criada ANTES da conta: é ela que permite o reconciliador concluir
        // um cadastro que morreu entre o signUp e o vínculo.
        Row: {
          id: string
          campaign_id: string
          email_hash: string
          phone_match_key_br: string
          duration_days_snapshot: number
          state: 'reserved' | 'bound' | 'expired'
          user_id: string | null
          expires_at: string
          created_at: string
        }
        Insert: {
          campaign_id: string
          email_hash: string
          phone_match_key_br: string
          duration_days_snapshot: number
          state: 'reserved' | 'bound' | 'expired'
          expires_at: string
          user_id?: string | null
        }
        Update: {
          state?: 'reserved' | 'bound' | 'expired'
          user_id?: string | null
        }
        Relationships: []
      }
      plan_trials: {
        // Ledger: UM trial por telefone, para sempre. O telefone é a chave primária de
        // propósito — trocar de e-mail não devolve o benefício.
        Row: {
          phone_match_key_br: string
          campaign_id: string
          profile_id: string | null
          status: 'pendente_confirmacao' | 'ativo' | 'convertido' | 'expirado' | 'lapsed'
          duration_days_snapshot: number
          signup_at: string
          confirm_by: string
          granted_at: string | null
          expires_at: string | null
          converted_at: string | null
          expired_at: string | null
          lapsed_at: string | null
        }
        Insert: {
          phone_match_key_br: string
          campaign_id: string
          status: 'pendente_confirmacao' | 'ativo' | 'convertido' | 'expirado' | 'lapsed'
          duration_days_snapshot: number
          confirm_by: string
          profile_id?: string | null
        }
        Update: {
          status?: 'pendente_confirmacao' | 'ativo' | 'convertido' | 'expirado' | 'lapsed'
          profile_id?: string | null
          granted_at?: string | null
          expires_at?: string | null
          converted_at?: string | null
          expired_at?: string | null
          lapsed_at?: string | null
        }
        Relationships: []
      }
      trial_deliveries: {
        // Régua D0/D15/D25/D30. `state` é o despacho; `delivery` é o que a Meta reportou.
        // Os dois nunca se misturam: uma mensagem pode estar `accepted` e ter falhado a entrega.
        Row: {
          id: string
          phone_match_key_br: string
          stage: 'd0' | 'd15' | 'd25' | 'd30'
          state: 'pending' | 'reserved' | 'sealed' | 'accepted' | 'ambiguous' | 'skipped' | 'dead'
          delivery: 'none' | 'sent' | 'delivered' | 'read' | 'failed'
          due_at: string
          valid_until: string
          next_attempt_at: string | null
          lease_token: string | null
          lease_until: string | null
          attempts: number
          template: string | null
          params: Json | null
          provider_id: string | null
          sealed_at: string | null
          accepted_at: string | null
          ambiguous_at: string | null
          dead_at: string | null
          last_http_status: number | null
          last_graph_code: string | null
          last_error: string | null
          skip_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          phone_match_key_br: string
          stage: 'd0' | 'd15' | 'd25' | 'd30'
          due_at: string
          valid_until: string
        }
        Update: {
          state?: 'pending' | 'reserved' | 'sealed' | 'accepted' | 'ambiguous' | 'skipped' | 'dead'
          delivery?: 'none' | 'sent' | 'delivered' | 'read' | 'failed'
          next_attempt_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          attempts?: number
          template?: string | null
          params?: Json | null
          provider_id?: string | null
          sealed_at?: string | null
          accepted_at?: string | null
          ambiguous_at?: string | null
          dead_at?: string | null
          last_http_status?: number | null
          last_graph_code?: string | null
          last_error?: string | null
          skip_reason?: string | null
        }
        Relationships: []
      }
      whatsapp_status_events: {
        // Append-only. event_id = sha256(wamid|status|occurred_at|graph_error_code).
        Row: {
          event_id: string
          wamid: string | null
          biz_opaque_callback_data: string | null
          status: string
          graph_error_code: string | null
          occurred_at: string
          received_at: string
        }
        Insert: {
          event_id: string
          status: string
          occurred_at: string
          wamid?: string | null
          biz_opaque_callback_data?: string | null
          graph_error_code?: string | null
        }
        // Append-only por contrato: o Update existe só para satisfazer o tipo do cliente.
        Update: {
          wamid?: string | null
          biz_opaque_callback_data?: string | null
          graph_error_code?: string | null
        }
        Relationships: []
      }
      account_capabilities: {
        // Capacidades que NÃO são flag de plano. Hoje só `lead_whatsapp` (o aviso de lead no
        // WhatsApp do cliente), que antes dependia de uma allowlist de ids em env var.
        Row: {
          profile_id: string
          capability: 'lead_whatsapp'
          valid_until: string | null
          source: string
          granted_at: string
        }
        Insert: {
          profile_id: string
          capability: 'lead_whatsapp'
          source: string
          valid_until?: string | null
        }
        Update: {
          valid_until?: string | null
          source?: string
        }
        Relationships: []
      }
      billing_locks: {
        // Lock com DONO. O release só apaga se o owner_token bater — sem isso, um executor
        // lento apagava o lock de quem assumiu depois dele.
        Row: {
          lock_key: string
          owner_token: string
          lease_until: string
          updated_at: string
        }
        Insert: {
          lock_key: string
          owner_token: string
          lease_until: string
          updated_at?: string
        }
        Update: {
          owner_token?: string
          lease_until?: string
          updated_at?: string
        }
        Relationships: []
      }
      trial_claim_attempts: {
        // Tentativa inválida de usar um link de trial. É LOG: nunca invalida a oferta de
        // quem tem direito (senão um terceiro derrubaria o trial alheio de propósito).
        Row: {
          id: string
          phone_tentado: string | null
          campaign_codigo: string | null
          motivo: string
          created_at: string
        }
        Insert: {
          motivo: string
          phone_tentado?: string | null
          campaign_codigo?: string | null
        }
        // Append-only por contrato (é log).
        Update: {
          motivo?: string
          phone_tentado?: string | null
          campaign_codigo?: string | null
        }
        Relationships: []
      }
      hero_followup_outbox: {
        // Fila do follow-up do hero da landing (migration 20260820_hero_followup_outbox, D-10).
        // UNIQUE(response_id): no máximo UMA mensagem por teste da demonstração.
        Row: {
          id: string
          response_id: string
          phone: string
          nome: string
          objetivo: string
          recomendacao: string
          due_at: string
          status: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed' | 'expired'
          skip_reason: string | null
          attempts: number
          last_error: string | null
          last_attempt_at: string | null
          sent_at: string | null
          wamid: string | null
          lease_token: string | null
          leased_at: string | null
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          response_id: string
          phone: string
          nome: string
          objetivo: string
          recomendacao: string
          due_at: string
          expires_at: string
        }
        Update: {
          status?: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed' | 'expired'
          skip_reason?: string | null
          attempts?: number
          last_error?: string | null
          last_attempt_at?: string | null
          sent_at?: string | null
          wamid?: string | null
          lease_token?: string | null
          leased_at?: string | null
          due_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      capi_outbox: {
        // Fila de entrega do CAPI (migration 20260818_capi_outbox). Snapshot imutável por
        // (response_id, trigger_id); o event_id persistido é reusado em toda retentativa.
        Row: {
          id: string
          response_id: string
          form_id: string
          trigger_id: string
          pixel_id: string
          event_name: string
          event_id: string
          event_time: string
          value: number | null
          currency: string | null
          action_source: string
          event_source_url: string | null
          user_data: Record<string, Json>
          test_event_code: string | null
          payload_version: number
          status: 'pending' | 'processing' | 'sent' | 'retryable' | 'blocked_auth' | 'dead' | 'expired'
          attempts: number
          last_error: string | null
          last_attempt_at: string | null
          sent_at: string | null
          next_attempt_at: string
          expires_at: string
          lease_token: string | null
          leased_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          response_id: string
          form_id: string
          trigger_id: string
          pixel_id: string
          event_name: string
          event_id: string
          event_time: string
          value?: number | null
          currency?: string | null
          action_source?: string
          event_source_url?: string | null
          user_data?: Record<string, Json>
          test_event_code?: string | null
          expires_at: string
        }
        Update: {
          status?: 'pending' | 'processing' | 'sent' | 'retryable' | 'blocked_auth' | 'dead' | 'expired'
          attempts?: number
          last_error?: string | null
          last_attempt_at?: string | null
          sent_at?: string | null
          next_attempt_at?: string
          lease_token?: string | null
          leased_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      form_capi_credentials: {
        // Token da API de Conversões do Meta, POR FORMULÁRIO e CIFRADO
        // (migration 20260818_form_capi_credentials). Fora de `forms` de propósito:
        // `forms.pixels` viaja para o navegador do visitante e o token não pode ir junto.
        Row: {
          form_id: string
          token_encrypted: string
          hint: string | null
          pixel_id: string | null
          validated_at: string | null
          last_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          form_id: string
          token_encrypted: string
          hint?: string | null
          pixel_id?: string | null
          validated_at?: string | null
          last_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          token_encrypted?: string
          hint?: string | null
          pixel_id?: string | null
          validated_at?: string | null
          last_error?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      answer_items: {
        Row: {
          id: string
          response_id: string
          question_id: string
          value: string | null
          created_at: string
        }
        Insert: {
          id?: string
          response_id: string
          question_id: string
          value?: string | null
          created_at?: string
        }
        Update: {
          value?: string | null
        }
        Relationships: []
      }
    }
  }
}

// Convenience types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type FolderRow = Database['public']['Tables']['folders']['Row']
export type FolderInsert = Database['public']['Tables']['folders']['Insert']
export type FolderUpdate = Database['public']['Tables']['folders']['Update']
export type Form = Database['public']['Tables']['forms']['Row']
export type FormInsert = Database['public']['Tables']['forms']['Insert']
export type FormUpdate = Database['public']['Tables']['forms']['Update']
export type Response = Database['public']['Tables']['responses']['Row']
export type ResponseInsert = Database['public']['Tables']['responses']['Insert']
export type ResponseUpdate = Database['public']['Tables']['responses']['Update']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
export type CustomDomainInsert = Database['public']['Tables']['custom_domains']['Insert']
export type CustomDomainUpdate = Database['public']['Tables']['custom_domains']['Update']
export type AnswerItemInsert = Database['public']['Tables']['answer_items']['Insert']
