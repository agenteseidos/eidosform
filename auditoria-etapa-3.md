# Auditoria ETAPA 3

## Status
APROVADA

## P0/P1 restantes
Nenhum P0/P1 restante

## Correções validadas
- `0ba5ba0` — API key deixou de ser persistida em plaintext e passou a usar hash SHA-256 como base de autenticação
- `0ba5ba0` — dashboard deixou de usar `select('*')` e passou a buscar contagens agregadas por RPC
- `0ba5ba0` — `handleDowngrade` deixou de carregar responses em excesso e passou a usar RPC agregada por formulário
- `0ba5ba0` — `GET /api/upload` agora exige autenticação
- `0ba5ba0` — `PATCH /api/forms/[id]` passou a rejeitar payload abusivo acima de 500KB
- `0ba5ba0` — `welcome_image_url` passou a bloquear `.svg` e `.svgz`
- `0ba5ba0` — webhook do Asaas removeu o fallback inseguro por query string e aceita apenas header/HMAC

## Correções feitas pela auditoria
- commit `b2c888c` — corrigido `DELETE /api/settings/api-key` para limpar também `api_key_hash`, evitando que a chave revogada continuasse válida
- commit `b2c888c` — corrigido fallback legacy de `authenticateApiKey` para também aplicar gate de plano e rate limit
- commit `b2c888c` — integrado o RPC `check_and_increment_response` ao endpoint `POST /api/responses`, validando de fato o incremento atômico prometido na etapa

## Commits relevantes da etapa
- `0ba5ba0` — fix(P2): ETAPA 3 — P2 prioritários
- `b2c888c` — fix(audit): close etapa 3 audit findings

## Veredito final
A ETAPA 3 pode avançar, porque após os ajustes da auditoria não restaram P0/P1 em aberto.
