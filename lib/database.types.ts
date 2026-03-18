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
  | 'url'

// Form status
export type FormStatus = 'draft' | 'published' | 'closed'

// Plan tiers
export type PlanType = 'free' | 'pro' | 'enterprise'

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
    }
    Enums: {
      form_status: 'draft' | 'published' | 'closed'
      theme_preset: 'midnight' | 'ocean' | 'sunset' | 'forest' | 'lavender' | 'minimal'
    }
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          plan: string
          api_key: string | null
          response_count: number
          limit_alert_sent: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          plan?: string
          api_key?: string | null
          response_count?: number
          limit_alert_sent?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          plan?: string
          api_key?: string | null
          response_count?: number
          limit_alert_sent?: boolean
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
          theme: ThemePreset
          questions: QuestionConfig[]
          thank_you_message: string
          pixels: PixelConfig | null
          plan: PlanType
          redirect_url: string | null
          webhook_url: string | null
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
          theme?: ThemePreset
          questions?: QuestionConfig[]
          thank_you_message?: string
          pixels?: PixelConfig | null
          plan?: PlanType
          redirect_url?: string | null
          webhook_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          slug?: string
          status?: FormStatus
          theme?: ThemePreset
          questions?: QuestionConfig[]
          thank_you_message?: string
          pixels?: PixelConfig | null
          plan?: PlanType
          redirect_url?: string | null
          webhook_url?: string | null
          updated_at?: string
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
