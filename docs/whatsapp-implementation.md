# WhatsApp Integration Implementation

## Overview

This document describes the complete WhatsApp integration for EidosForm, including database schema, TypeScript types, API helpers, and usage examples.

## Architecture

### ETAPA 1: Endpoint `/api/whatsapp/send`

**File:** `app/api/whatsapp/send/route.ts`

Sends WhatsApp messages via wacli CLI. Supports:
- Bearer token authentication (Supabase)
- Plan-based authorization (Plus+ only)
- Phone number validation (55 + 11-13 digits)
- Rate limiting
- Error handling with detailed diagnostics

**Endpoint Signature:**
```
POST /api/whatsapp/send
Authorization: Bearer {supabase_token}
Content-Type: application/json

{
  "instance": "default",
  "to": "5511999999999",
  "message": "Hello from EidosForm!"
}
```

**Response Codes:**
- `200` - Message sent successfully
- `400` - Invalid input (missing fields, invalid phone)
- `401` - Unauthorized (no Bearer token)
- `403` - Forbidden (insufficient plan)
- `429` - Rate limit exceeded
- `503` - wacli service unavailable
- `500` - Internal server error

### ETAPA 2: Database Schema

**Table:** `form_whatsapp_settings`

Stores WhatsApp configuration per form.

#### Schema Definition

```sql
CREATE TABLE form_whatsapp_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  owner_phone VARCHAR(20) NOT NULL,
  message_template TEXT DEFAULT 'Nova resposta em {form_name}: {nome}',
  instance_name VARCHAR(50) DEFAULT 'default',
  rate_limit_per_hour INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  UNIQUE(form_id)
);
```

#### Fields

- **id:** UUID primary key, auto-generated
- **form_id:** Foreign key to `forms` table, cascading delete
- **enabled:** Boolean flag to enable/disable WhatsApp notifications
- **owner_phone:** Form owner's phone number (required)
- **message_template:** Customizable message template with placeholders
  - Available placeholders: `{form_name}`, `{nome}` (form responses field)
  - Default: `'Nova resposta em {form_name}: {nome}'`
- **instance_name:** wacli instance identifier (default: `'default'`)
- **rate_limit_per_hour:** Maximum messages per hour (default: 100)
- **created_at:** Timestamp of creation
- **updated_at:** Timestamp of last update
- **created_by:** UUID of the user who created the settings

#### Constraints

- Unique constraint on `form_id` (one setting per form)
- Foreign key on `form_id` with cascade delete
- Foreign key on `created_by` (references `auth.users`)

#### Row Level Security (RLS)

Four policies enforce user isolation:

1. **SELECT Policy:** Users can only view WhatsApp settings for forms they own
2. **UPDATE Policy:** Users can only update settings for their own forms
3. **INSERT Policy:** Users can only create settings for their own forms
4. **DELETE Policy:** Users can only delete settings for their own forms

All policies verify ownership by checking `forms.user_id = auth.uid()`.

#### Indexes

- `idx_form_whatsapp_settings_form_id` - for form-scoped queries
- `idx_form_whatsapp_settings_created_by` - for user-scoped queries

#### Migration File

**Location:** `supabase/migrations/20260405_form_whatsapp_settings.sql`

Execute via Supabase dashboard or CLI:
```bash
supabase migration up
```

### ETAPA 3: TypeScript Types

**File:** `lib/types/whatsapp.ts`

```typescript
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
```

### ETAPA 4: Database Helpers

**File:** `lib/whatsapp.ts`

Provides CRUD operations for WhatsApp settings with RLS enforcement.

#### Functions

##### `getWhatsAppSettings(formId: string)`

Fetches WhatsApp settings for a form.

```typescript
import { getWhatsAppSettings } from '@/lib/whatsapp';

const settings = await getWhatsAppSettings('form-uuid-123');
if (!settings) {
  console.log('No settings configured');
}
```

**Returns:** `Promise<FormWhatsAppSettings | null>`

**Notes:**
- Returns `null` if no settings exist (RLS enforced)
- Throws error on Supabase connectivity issues

##### `createWhatsAppSettings(data, userId)`

Creates WhatsApp settings for a form.

```typescript
import { createWhatsAppSettings } from '@/lib/whatsapp';

const settings = await createWhatsAppSettings(
  {
    form_id: 'form-uuid-123',
    owner_phone: '5511999999999',
    enabled: true,
    message_template: 'Novo envio em {form_name}: {nome}',
    instance_name: 'default',
    rate_limit_per_hour: 100,
  },
  userId // from auth context
);
```

**Parameters:**
- `data`: `CreateFormWhatsAppSettingsInput`
- `userId`: User ID from Supabase auth

**Returns:** `Promise<FormWhatsAppSettings>`

**Notes:**
- Uses service role key for server-side operations
- Enforces RLS via `created_by` field
- Unique constraint on `form_id` prevents duplicates
- Throws error if `form_id` already exists

##### `updateWhatsAppSettings(formId, data)`

Updates WhatsApp settings for a form.

```typescript
import { updateWhatsAppSettings } from '@/lib/whatsapp';

const updated = await updateWhatsAppSettings('form-uuid-123', {
  enabled: true,
  message_template: 'Updated template: {form_name}',
});
```

**Parameters:**
- `formId`: Form ID
- `data`: `UpdateFormWhatsAppSettingsInput` (partial update)

**Returns:** `Promise<FormWhatsAppSettings>`

**Notes:**
- Auto-updates `updated_at` timestamp
- Supports partial updates
- RLS enforced via form ownership

##### `deleteWhatsAppSettings(formId)`

Deletes WhatsApp settings for a form.

```typescript
import { deleteWhatsAppSettings } from '@/lib/whatsapp';

await deleteWhatsAppSettings('form-uuid-123');
```

**Parameters:**
- `formId`: Form ID

**Returns:** `Promise<void>`

**Notes:**
- RLS enforced via form ownership
- Silent success on non-existent settings

## Usage Examples

### Example 1: Enable WhatsApp for a Form

```typescript
import { createWhatsAppSettings } from '@/lib/whatsapp';
import { getRequestUser } from '@/lib/auth';

// In an API route or server action
const user = await getRequestUser();

const settings = await createWhatsAppSettings(
  {
    form_id: formId,
    owner_phone: '5511987654321',
    enabled: true,
  },
  user.id
);

console.log('WhatsApp enabled for form:', settings.form_id);
```

### Example 2: Update Message Template

```typescript
import { updateWhatsAppSettings } from '@/lib/whatsapp';

const updated = await updateWhatsAppSettings(formId, {
  message_template: 'New lead in {form_name}: {nome} (${valor})',
});

console.log('Template updated:', updated.message_template);
```

### Example 3: Disable WhatsApp

```typescript
import { updateWhatsAppSettings } from '@/lib/whatsapp';

await updateWhatsAppSettings(formId, {
  enabled: false,
});
```

### Example 4: Fetch and Display Settings

```typescript
import { getWhatsAppSettings } from '@/lib/whatsapp';

const settings = await getWhatsAppSettings(formId);

if (!settings) {
  return <p>WhatsApp not configured</p>;
}

return (
  <div>
    <p>Status: {settings.enabled ? '✅ Enabled' : '❌ Disabled'}</p>
    <p>Owner: {settings.owner_phone}</p>
    <p>Template: {settings.message_template}</p>
  </div>
);
```

## Message Template Placeholders

The `message_template` field supports the following placeholders:

| Placeholder | Description | Example |
|---|---|---|
| `{form_name}` | Name of the form | "Contact Form" |
| `{nome}` | Value from form response field named "nome" | "João Silva" |
| `{email}` | Value from form response field named "email" | "joao@example.com" |

**Note:** Custom placeholders should match form field names exactly (case-sensitive).

## Rate Limiting

Each form configuration has a `rate_limit_per_hour` setting:
- Default: 100 messages/hour
- Adjustable per form
- Enforced at message send time (ETAPA 1 endpoint)

To update:
```typescript
await updateWhatsAppSettings(formId, {
  rate_limit_per_hour: 200, // new limit
});
```

## Security Considerations

### RLS Enforcement

- All queries are scoped to form ownership
- Users cannot access settings for forms they don't own
- Enforced at database level (not application level)

### Phone Number Validation

- Backend validation in ETAPA 1 endpoint
- Format: 55 + 11-13 digits (Brazilian format)
- Invalid numbers rejected with 400 status

### Plan-Based Access

- WhatsApp sending (ETAPA 1) requires Plus+ plan
- Settings management inherits user plan
- Enforce at API endpoint level

### Service Role Key

- Database helpers use `SUPABASE_SERVICE_ROLE_KEY`
- Should only be used on server side (API routes, server actions)
- Never expose to client

## Testing

### Test WhatsApp Settings Creation

```bash
# With valid form and user
curl -X POST http://localhost:3000/api/form/123/whatsapp/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "owner_phone": "5511999999999",
    "enabled": true
  }'
```

### Validate TypeScript

```bash
npx tsc --noEmit
# Should return zero errors
```

### Lint Helpers

```bash
npx eslint lib/whatsapp.ts lib/types/whatsapp.ts
# Should return zero errors
```

## Migration Checklist

### ETAPA 1-2 (Database & Types)
- [x] Create `form_whatsapp_settings` table
- [x] Enable RLS with 4 policies
- [x] Create indexes on `form_id` and `created_by`
- [x] Create TypeScript types
- [x] Create database helpers (GET, POST, PATCH, DELETE)
- [x] Document in this file
- [x] Run TypeScript validation
- [x] Run ESLint validation

### ETAPA 3 (API Endpoints)
- [x] Create GET `/api/form/[id]/whatsapp/settings`
- [x] Create POST `/api/form/[id]/whatsapp/settings`
- [x] Create PATCH `/api/form/[id]/whatsapp/settings`
- [x] Create DELETE `/api/form/[id]/whatsapp/settings`
- [x] Auth check (Bearer token)
- [x] Plan validation (Plus+ required for POST/PATCH)
- [x] Form ownership validation (user_id)
- [x] Input validation (owner_phone non-empty)
- [x] Proper HTTP status codes
- [x] Error handling
- [x] TypeScript validation (npx tsc --noEmit → 0 errors)
- [x] ESLint validation (npx eslint → 0 errors)
- [x] Documentation with curl examples

## Files Modified/Created

- ✅ `supabase/migrations/20260405_form_whatsapp_settings.sql` (ETAPA 2)
- ✅ `lib/types/whatsapp.ts` (ETAPA 2)
- ✅ `lib/whatsapp.ts` (ETAPA 2)
- ✅ `app/api/form/[id]/whatsapp/settings/route.ts` (ETAPA 3, new)
- ✅ `docs/whatsapp-implementation.md` (updated with ETAPA 3 docs)

### ETAPA 3: API Endpoints

**File:** `app/api/form/[id]/whatsapp/settings/route.ts`

RESTful API endpoints for managing WhatsApp settings.

#### GET `/api/form/[id]/whatsapp/settings`

Returns WhatsApp settings for a form.

**Request:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/form/FORM_ID/whatsapp/settings
```

**Response (200 OK):**
```json
{
  "id": "uuid",
  "form_id": "form-uuid",
  "enabled": true,
  "owner_phone": "+5511987654321",
  "message_template": "Nova resposta em {form_name}: {nome}",
  "instance_name": "default",
  "rate_limit_per_hour": 100,
  "created_at": "2026-04-05T00:00:00Z",
  "updated_at": "2026-04-05T00:00:00Z",
  "created_by": "user-uuid"
}
```

**Response Codes:**
- `200` - Settings found
- `401` - Unauthorized (no auth)
- `403` - Forbidden (not form owner)
- `404` - Form or settings not found

---

#### POST `/api/form/[id]/whatsapp/settings`

Creates WhatsApp settings for a form.

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "owner_phone": "+5511987654321",
    "message_template": "Nova resposta: {nome}",
    "enabled": true,
    "instance_name": "default",
    "rate_limit_per_hour": 100
  }' \
  http://localhost:3000/api/form/FORM_ID/whatsapp/settings
```

**Request Body:**
- `owner_phone` (required): Phone number (non-empty string)
- `enabled` (optional, default: false): Enable WhatsApp notifications
- `message_template` (optional): Custom message template
- `instance_name` (optional, default: "default"): wacli instance
- `rate_limit_per_hour` (optional, default: 100): Rate limit

**Response (201 Created):**
```json
{
  "id": "uuid",
  "form_id": "form-uuid",
  "enabled": false,
  "owner_phone": "+5511987654321",
  "message_template": "Nova resposta em {form_name}: {nome}",
  "instance_name": "default",
  "rate_limit_per_hour": 100,
  "created_at": "2026-04-05T00:00:00Z",
  "updated_at": "2026-04-05T00:00:00Z",
  "created_by": "user-uuid"
}
```

**Response Codes:**
- `201` - Settings created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (no auth)
- `403` - Forbidden (not Plus+ plan or not form owner)
- `404` - Form not found
- `409` - Conflict (settings already exist)

**Validation:**
- `owner_phone` must be non-empty string
- User must have Plus+ plan (plus or professional)
- User must be form owner
- Form must exist
- Settings must not already exist for this form

---

#### PATCH `/api/form/[id]/whatsapp/settings`

Updates WhatsApp settings for a form.

**Request:**
```bash
curl -X PATCH -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "enabled": true,
    "message_template": "Updated: {form_name}"
  }' \
  http://localhost:3000/api/form/FORM_ID/whatsapp/settings
```

**Request Body (all optional):**
- `enabled`: Enable/disable notifications
- `owner_phone`: Update phone number (must be non-empty if provided)
- `message_template`: Update message template
- `instance_name`: Update wacli instance
- `rate_limit_per_hour`: Update rate limit

**Response (200 OK):**
```json
{
  "id": "uuid",
  "form_id": "form-uuid",
  "enabled": true,
  "owner_phone": "+5511987654321",
  "message_template": "Updated: EidosForm",
  "instance_name": "default",
  "rate_limit_per_hour": 100,
  "created_at": "2026-04-05T00:00:00Z",
  "updated_at": "2026-04-05T00:01:00Z",
  "created_by": "user-uuid"
}
```

**Response Codes:**
- `200` - Settings updated
- `400` - Bad Request (validation error)
- `401` - Unauthorized (no auth)
- `403` - Forbidden (not Plus+ plan or not form owner)
- `404` - Form or settings not found

**Validation:**
- User must have Plus+ plan
- User must be form owner
- Settings must exist
- `owner_phone` must be non-empty if provided

---

#### DELETE `/api/form/[id]/whatsapp/settings`

Deletes WhatsApp settings for a form.

**Request:**
```bash
curl -X DELETE -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/form/FORM_ID/whatsapp/settings
```

**Response (204 No Content):**
```
(no body)
```

**Response Codes:**
- `204` - Settings deleted
- `401` - Unauthorized (no auth)
- `403` - Forbidden (not form owner)
- `404` - Form or settings not found

---

## Next Steps

- **ETAPA 4:** Integrate settings into form response handlers (auto-send WhatsApp on response)
- **ETAPA 5:** Add WhatsApp dashboard UI component
- **ETAPA 6:** Implement webhook handling for WhatsApp delivery/read receipts
