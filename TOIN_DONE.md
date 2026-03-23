# TOIN_DONE — BUG-004

## FIXES_CONCLUIDOS

### P1-B1: CEP com máscara automática
- `handleCepChange` agora formata automaticamente para `00000-000`
- Limita input a 8 dígitos
- Lookup de endereço preserva valor formatado

### P1-B2: Campo CPF com máscara e validação
- Adicionado `'cpf'` ao tipo `QuestionType`
- Adicionada entrada CPF em `lib/questions.ts` (ícone Fingerprint)
- Criado componente `CpfQuestion` com máscara `000.000.000-00` e validação matemática

## Arquivos alterados
- `lib/database.types.ts` — adicionado tipo `'cpf'`
- `lib/questions.ts` — entrada CPF com label, ícone e config
- `components/form-player/question-renderer.tsx` — fix CEP mask + componente CpfQuestion + case no switch

## Commit
`fix: BUG-004 máscara automática CEP e campo CPF com máscara`
