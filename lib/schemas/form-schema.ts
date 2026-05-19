/**
 * lib/schemas/form-schema.ts — Zod schemas for form create/update payloads
 *
 * Etapa 7 (P1-A): defense-in-depth validation for POST /api/forms and PATCH
 * /api/forms/[id]. The route handlers still apply business-rule checks
 * (slug, plan limits, feature gates) AFTER schema validation.
 */
import { z } from 'zod'
import type { QuestionType } from '@/lib/database.types'

const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'dropdown',
  'checkboxes',
  'email',
  'phone',
  'number',
  'date',
  'rating',
  'opinion_scale',
  'yes_no',
  'file_upload',
  'nps',
  'url',
  'address',
  'cpf',
  'calendly',
  'html_block',
  'content_block',
] as const satisfies readonly QuestionType[]

import { isSafeUrl } from '@/lib/html'

const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:', 'tel:', 'sms:'] as const

const safeUrl = z
  .string()
  .max(2048, 'URL muito longa')
  .refine(isSafeUrl, { message: 'URL com protocolo não permitido' })

const optionalSafeUrl = z
  .union([safeUrl, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v === '' || v === undefined ? null : v))

// Conditional logic rule referenced from QuestionConfig.conditionalLogic
const ConditionalRuleSchema = z
  .object({
    questionId: z.string(),
    operator: z.enum(['equals', 'not_equals', 'contains', 'not_empty', 'is_empty']),
    value: z.string().max(2000).optional(),
  })
  .strict()

// Pixel event rule (one entry inside QuestionConfig.pixelEvents)
const PixelEventRuleSchema = z
  .object({
    id: z.string().min(1).max(120),
    condition: z
      .object({
        operator: z.enum([
          'equals',
          'not_equals',
          'contains',
          'not_contains',
          'greater_than',
          'less_than',
          'is_empty',
          'is_not_empty',
        ]),
        value: z.string().max(2000),
      })
      .strip(),
    event: z
      .object({
        type: z.enum(['standard', 'custom']),
        name: z.string().min(1).max(120),
        value: z.number().finite().optional(),
        currency: z.string().trim().min(3).max(3).optional(),
      })
      .strip(),
  })
  .strip()

// Jump rule (one entry inside QuestionConfig.jumpRules)
const JumpRuleSchema = z
  .object({
    id: z.string().min(1).max(120),
    condition: z
      .object({
        questionId: z.string().min(1).max(120),
        operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'not_empty', 'is_empty']),
        value: z.string().max(2000),
      })
      .strip(),
    action: z
      .object({
        type: z.enum(['jump', 'submit']),
        targetQuestionId: z.union([z.string().min(1).max(120), z.literal('')]).transform(v => v === '' ? undefined : v).optional(),
      })
      .strip(),
  })
  .strip()

const QuestionBaseShape = {
  id: z.string().min(1).max(120),
  type: z.enum(QUESTION_TYPES),
  title: z.string().max(2000).default(''),
  description: z.string().max(5000).optional().nullable(),
  required: z.boolean().default(false),
  placeholder: z.string().max(500).optional().nullable(),
  defaultCountry: z.string().max(8).optional().nullable(),
  conditionalLogic: ConditionalRuleSchema.optional(),
  pixelEvents: z.array(PixelEventRuleSchema).max(40).optional(),
  jumpRules: z.array(JumpRuleSchema).max(40).optional(),
  imageUrl: optionalSafeUrl.optional(),
  videoUrl: optionalSafeUrl.optional(),
  // Posição manual do bloco no Mapa da Lógica (quando o usuário arrasta).
  mapX: z.number().optional(),
  mapY: z.number().optional(),
}

const stringOptionList = z
  .array(z.string().max(500))
  .max(200, 'Máximo de 200 opções por campo')

// Discriminated union by `type` so each question only accepts its valid fields.
export const QuestionSchema = z.discriminatedUnion('type', [
  z.object({ ...QuestionBaseShape, type: z.literal('short_text') }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('long_text') }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('dropdown'),
    options: stringOptionList.optional(),
  }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('checkboxes'),
    options: stringOptionList.optional(),
  }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('email') }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('phone') }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('number'),
    minValue: z.number().finite().optional(),
    maxValue: z.number().finite().optional(),
  }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('date') }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('rating'),
    minValue: z.number().int().min(0).max(20).optional(),
    maxValue: z.number().int().min(1).max(20).optional(),
  }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('opinion_scale'),
    minValue: z.number().int().min(0).max(20).optional(),
    maxValue: z.number().int().min(1).max(20).optional(),
  }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('yes_no') }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('file_upload'),
    allowedFileTypes: z.array(z.string().max(80)).max(20).optional(),
    maxFileSize: z.number().int().min(1).max(25).optional(),
  }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('nps'),
    minValue: z.number().int().min(0).max(20).optional(),
    maxValue: z.number().int().min(1).max(20).optional(),
  }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('url') }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('address') }).strip(),
  z.object({ ...QuestionBaseShape, type: z.literal('cpf') }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('calendly'),
    calendlyUrl: optionalSafeUrl.optional(),
  }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('html_block'),
    htmlContent: z.string().max(50_000).optional().nullable(),
    htmlBlockNote: z.string().max(5_000).optional().nullable(),
  }).strip(),
  z.object({
    ...QuestionBaseShape,
    type: z.literal('content_block'),
    contentBody: z.string().max(50_000).optional().nullable(),
    contentButtonText: z.string().max(120).optional().nullable(),
    contentButtonUrl: optionalSafeUrl.optional(),
  }).strip(),
])

export type QuestionPayload = z.infer<typeof QuestionSchema>

const PixelsSchema = z
  .object({
    metaPixelId: z.string().max(40).nullable().optional(),
    googleAdsId: z.string().max(40).nullable().optional(),
    googleAdsLabel: z.string().max(80).nullable().optional(),
    tiktokPixelId: z.string().max(40).nullable().optional(),
    gtmId: z.string().max(40).nullable().optional(),
  })
  .passthrough()

const slugSchema = z
  .string()
  .min(3)
  .max(61)
  .regex(/^[a-z0-9][a-z0-9-]{2,60}$/, {
    message:
      'slug deve ter entre 3 e 61 caracteres, começar com letra ou número, e conter apenas letras minúsculas, números e hífens',
  })

const QuestionsArraySchema = z
  .array(QuestionSchema)
  .max(500, 'Número de perguntas excede o limite')

const baseFormShape = {
  title: z.string().min(1, 'Título obrigatório').max(200),
  description: z.string().max(2000).nullable().optional(),
  slug: slugSchema,
  status: z.enum(['draft', 'published', 'closed']).optional(),
  theme: z.enum(['midnight', 'ocean', 'sunset', 'forest', 'lavender', 'minimal']).optional(),
  questions: QuestionsArraySchema.optional(),
  thank_you_message: z.string().max(5000).optional(),
  thank_you_title: z.string().max(200).nullable().optional(),
  thank_you_description: z.string().max(5000).nullable().optional(),
  thank_you_button_text: z.string().max(120).nullable().optional(),
  thank_you_button_url: optionalSafeUrl.optional(),
  pixels: z.union([PixelsSchema, z.null()]).optional(),
  redirect_url: optionalSafeUrl.optional(),
  webhook_url: optionalSafeUrl.optional(),
  pixel_event_on_start: z.string().max(120).nullable().optional(),
  pixel_event_on_complete: z.string().max(120).nullable().optional(),
  welcome_enabled: z.boolean().optional(),
  welcome_title: z.string().max(200).nullable().optional(),
  welcome_description: z.string().max(2000).nullable().optional(),
  welcome_button_text: z.string().max(120).nullable().optional(),
  welcome_image_url: optionalSafeUrl.optional(),
  is_closed: z.boolean().optional(),
  hide_branding: z.boolean().optional(),
  notify_email_enabled: z.boolean().optional(),
  notify_email: z.string().email().max(320).nullable().optional().or(z.literal('')),
  notify_whatsapp_enabled: z.boolean().optional(),
  notify_whatsapp_number: z.string().max(40).nullable().optional(),
  google_sheets_enabled: z.boolean().optional(),
  google_sheets_id: z.string().max(120).nullable().optional(),
  google_sheets_share_email: z.string().max(320).nullable().optional(),
  google_sheets_url: z.string().max(2048).nullable().optional(),
}

export const FormCreateSchema = z
  .object({
    ...baseFormShape,
    title: baseFormShape.title,
    slug: baseFormShape.slug,
  })
  .strip()

export const FormUpdateSchema = z
  .object({
    ...baseFormShape,
    title: baseFormShape.title.optional(),
    slug: baseFormShape.slug.optional(),
  })
  .strip()

export type FormCreatePayload = z.infer<typeof FormCreateSchema>
export type FormUpdatePayload = z.infer<typeof FormUpdateSchema>

/** Format ZodError issues for the JSON 400 response. */
export function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}
