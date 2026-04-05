import { createClient } from '@supabase/supabase-js';
import {
  FormWhatsAppSettings,
  CreateFormWhatsAppSettingsInput,
  UpdateFormWhatsAppSettingsInput,
} from './types/whatsapp';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

// Service role client for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Get WhatsApp settings for a form
 * @param formId - The form ID
 * @returns FormWhatsAppSettings or null if not found
 */
export async function getWhatsAppSettings(
  formId: string
): Promise<FormWhatsAppSettings | null> {
  try {
    const { data, error } = await supabase
      .from('form_whatsapp_settings')
      .select('*')
      .eq('form_id', formId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No row found
        return null;
      }
      throw error;
    }

    return data as FormWhatsAppSettings;
  } catch (error) {
    console.error('[whatsapp] Error fetching settings:', error);
    throw error;
  }
}

/**
 * Create WhatsApp settings for a form
 * @param data - The settings data
 * @param userId - The user ID of the creator
 * @returns The created FormWhatsAppSettings
 */
export async function createWhatsAppSettings(
  data: CreateFormWhatsAppSettingsInput,
  userId: string
): Promise<FormWhatsAppSettings> {
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('form_whatsapp_settings')
      .insert({
        form_id: data.form_id,
        enabled: data.enabled ?? false,
        owner_phone: data.owner_phone,
        message_template:
          data.message_template ?? 'Nova resposta em {form_name}: {nome}',
        instance_name: data.instance_name ?? 'default',
        rate_limit_per_hour: data.rate_limit_per_hour ?? 100,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return settings as FormWhatsAppSettings;
  } catch (error) {
    console.error('[whatsapp] Error creating settings:', error);
    throw error;
  }
}

/**
 * Update WhatsApp settings for a form
 * @param formId - The form ID
 * @param data - The partial settings data to update
 * @returns The updated FormWhatsAppSettings
 */
export async function updateWhatsAppSettings(
  formId: string,
  data: UpdateFormWhatsAppSettingsInput
): Promise<FormWhatsAppSettings> {
  try {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled;
    }
    if (data.owner_phone !== undefined) {
      updateData.owner_phone = data.owner_phone;
    }
    if (data.message_template !== undefined) {
      updateData.message_template = data.message_template;
    }
    if (data.instance_name !== undefined) {
      updateData.instance_name = data.instance_name;
    }
    if (data.rate_limit_per_hour !== undefined) {
      updateData.rate_limit_per_hour = data.rate_limit_per_hour;
    }

    const { data: settings, error } = await supabaseAdmin
      .from('form_whatsapp_settings')
      .update(updateData)
      .eq('form_id', formId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return settings as FormWhatsAppSettings;
  } catch (error) {
    console.error('[whatsapp] Error updating settings:', error);
    throw error;
  }
}

/**
 * Delete WhatsApp settings for a form
 * @param formId - The form ID
 */
export async function deleteWhatsAppSettings(formId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('form_whatsapp_settings')
      .delete()
      .eq('form_id', formId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('[whatsapp] Error deleting settings:', error);
    throw error;
  }
}
