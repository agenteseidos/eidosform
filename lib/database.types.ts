import { PixelEventRule } from "@/types/pixel-events"

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

// Conditional logic operators
export type ConditionalOperator = 'equals' | 'not_equals' | 'contains' | 'not_empty' | 'is_empty'

// Conditional logic rule
export interface ConditionalRule {
  questionId: string
  operator: ConditionalOperator
  value?: string
}

// Form status
export type FormStatus = 'draft' | 'published' | 'closed'

// Plan tiers
export type PlanType = 'free' | 'starter' | 'plus' | 'professional'

// Theme presets
export type ThemePreset = 
  | 'midnight'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'lavender'
  | 'minimal'

export interface ThemeConfig {
  id: ThemePreset
  name: string
  primaryColor: string
  backgroundColor: string
  textColor: string
  accentColor: string
  fontFamily: string
}

// Question configuration
export interface QuestionConfig {
  id: string
  type: QuestionType
  title: string
  description?: string
  required: boolean
  // Type-specific options
  options?: string[] // For dropdown and checkboxes
  minValue?: number // For rating (1-5 stars) or opinion_scale (1-10)
  maxValue?: number
  allowedFileTypes?: string[] // For file_upload
  maxFileSize?: number // In MB
  placeholder?: string
  defaultCountry?: string // Country code for phone type (default: BR)
  conditionalLogic?: ConditionalRule
  pixelEvents?: PixelEventRule[]
}

// Pixel tracking configuration
export interface PixelConfig {
  metaPixelId?: string       // Meta (Facebook) Pixel ID
  googleAdsId?: string       // Google Ads Conversion ID (AW-XXXXXXXXX)
  googleAdsLabel?: string    // Google Ads Conversion Label
  tiktokPixelId?: string     // TikTok Pixel ID
  gtmId?: string             // Google Tag Manager Container ID (GTM-XXXXXXX)
}

// Database tables
export interface Database {
  public: {
    Views: {
      [_ in never]: never
    }
    Functions: {
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
    }
    Enums: {
      form_status: 'draft' | 'published' | 'closed'
      theme_preset: 'midnight' | 'ocean' | 'sunset' | 'forest' | 'lavender' | 'minimal'
    }
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          plan: string
          api_key: string | null
          api_key_created_at: string | null
          response_count: number
          responses_used: number
          responses_limit: number
          limit_alert_sent: boolean
          plan_status: string | null
          plan_expires_at: string | null
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          plan?: string
          api_key?: string | null
          api_key_created_at?: string | null
          response_count?: number
          responses_used?: number
          responses_limit?: number
          limit_alert_sent?: boolean
          plan_status?: string | null
          plan_expires_at?: string | null
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          plan?: string
          api_key?: string | null
          api_key_created_at?: string | null
          response_count?: number
          responses_used?: number
          responses_limit?: number
          limit_alert_sent?: boolean
          plan_status?: string | null
          plan_expires_at?: string | null
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
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
      forms: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string | null
          slug: string
          status: FormStatus
          is_published: boolean
          theme: ThemePreset
          questions: QuestionConfig[]
          thank_you_message: string
          thank_you_title: string | null
          thank_you_description: string | null
          thank_you_button_text: string | null
          thank_you_button_url: string | null
          pixels: PixelConfig | null
          plan: PlanType
          redirect_url: string | null
          webhook_url: string | null
          pixel_event_on_start: string | null
          pixel_event_on_complete: string | null
          welcome_enabled: boolean
          welcome_title: string | null
          welcome_description: string | null
          welcome_button_text: string | null
          welcome_image_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          description?: string | null
          slug: string
          status?: FormStatus
          is_published?: boolean
          theme?: ThemePreset
          questions?: QuestionConfig[]
          thank_you_message?: string
          thank_you_title?: string | null
          thank_you_description?: string | null
          thank_you_button_text?: string | null
          thank_you_button_url?: string | null
          pixels?: PixelConfig | null
          plan?: PlanType
          redirect_url?: string | null
          webhook_url?: string | null
          created_at?: string
          pixel_event_on_start?: string | null
          pixel_event_on_complete?: string | null
          welcome_enabled?: boolean
          welcome_title?: string | null
          welcome_description?: string | null
          welcome_button_text?: string | null
          welcome_image_url?: string | null
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          slug?: string
          status?: FormStatus
          is_published?: boolean
          theme?: ThemePreset
          questions?: QuestionConfig[]
          thank_you_message?: string
          thank_you_title?: string | null
          thank_you_description?: string | null
          thank_you_button_text?: string | null
          thank_you_button_url?: string | null
          pixels?: PixelConfig | null
          plan?: PlanType
          redirect_url?: string | null
          webhook_url?: string | null
          updated_at?: string
          pixel_event_on_start?: string | null
          pixel_event_on_complete?: string | null
          welcome_enabled?: boolean
          welcome_title?: string | null
          welcome_description?: string | null
          welcome_button_text?: string | null
          welcome_image_url?: string | null
        }
        Relationships: []
      }
      responses: {
        Row: {
          id: string
          form_id: string
          answers: Record<string, Json>
          completed: boolean
          last_question_answered: string | null
          submitted_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          form_id: string
          answers: Record<string, Json>
          completed?: boolean
          last_question_answered?: string | null
          submitted_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          answers?: Record<string, Json>
          completed?: boolean
          last_question_answered?: string | null
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
export type Form = Database['public']['Tables']['forms']['Row']
export type FormInsert = Database['public']['Tables']['forms']['Insert']
export type FormUpdate = Database['public']['Tables']['forms']['Update']
export type Response = Database['public']['Tables']['responses']['Row']
export type ResponseInsert = Database['public']['Tables']['responses']['Insert']
