-- Adiciona o tema "Terracota" ao enum theme_preset.
-- Idempotente (IF NOT EXISTS). Não altera nenhum form existente — só amplia
-- os valores possíveis da coluna forms.theme. Frontend correspondente:
-- lib/themes.ts (objeto do tema) + lib/database.types.ts (tipo ThemePreset).
ALTER TYPE theme_preset ADD VALUE IF NOT EXISTS 'terracota';
