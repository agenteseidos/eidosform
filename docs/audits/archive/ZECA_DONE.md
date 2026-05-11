# ZECA_DONE — BUG-003

FIXES_CONCLUIDOS

## O que foi feito
- Implementado suporte a `Authorization: Bearer <api_key>` na função `authenticateApiKey`
- X-API-Key continua funcionando (retrocompatível)
- Bearer extrai o token após "Bearer " e valida igual ao X-API-Key
- Fix aplicado em ambos os arquivos de rota

## Arquivos alterados
- `app/api/v1/forms/route.ts`
- `app/api/v1/forms/[id]/route.ts`

## Commit
`fix: BUG-003 suporte a Authorization Bearer na API pública` (90fd1ef)
