export type FormWhatsAppSettings = {
  id: string;
  form_id: string;
  enabled: boolean;
  owner_phone: string;
  message_template: string;
  instance_name: string;
  rate_limit_per_hour: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};

export type CreateFormWhatsAppSettingsInput = {
  form_id: string;
  enabled?: boolean;
  owner_phone: string;
  message_template?: string;
  instance_name?: string;
  rate_limit_per_hour?: number;
};

export type UpdateFormWhatsAppSettingsInput = Partial<
  Omit<CreateFormWhatsAppSettingsInput, 'form_id'>
>;
