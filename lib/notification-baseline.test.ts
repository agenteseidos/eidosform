import { describe, it, expect } from 'vitest'
import {
  detectNewlyActivatedRecipients,
  baselineAbandonedEmailClaims,
  recipientHash,
  hasAnsweredSomething,
  BASELINE_MARKER,
  type BaselineClient,
} from './notification-baseline'

const OWNER = 'dono@clinica.com'
const EXTRA = 'equipe@empresa.com'

const prevBase = {
  notify_owner_enabled: null as boolean | null,
  notify_email_enabled: false as boolean | null,
  notify_email: null as string | null,
}

describe('detectNewlyActivatedRecipients', () => {
  it('save sem mexer em notificação não ativa ninguém', () => {
    expect(
      detectNewlyActivatedRecipients({ prev: prevBase, next: {}, ownerEmail: OWNER })
    ).toEqual([])
  })

  it('legado (null) já conta como dono ATIVO — reafirmar true não é transição', () => {
    expect(
      detectNewlyActivatedRecipients({
        prev: prevBase,
        next: { notify_owner_enabled: true },
        ownerEmail: OWNER,
      })
    ).toEqual([])
  })

  it('dono false→true é transição (o caso da rajada de 05/08)', () => {
    const out = detectNewlyActivatedRecipients({
      prev: { ...prevBase, notify_owner_enabled: false },
      next: { notify_owner_enabled: true },
      ownerEmail: OWNER,
    })
    expect(out).toEqual([{ email: OWNER, role: 'owner' }])
  })

  it('desligar o dono nunca ativa nada', () => {
    expect(
      detectNewlyActivatedRecipients({
        prev: prevBase,
        next: { notify_owner_enabled: false },
        ownerEmail: OWNER,
      })
    ).toEqual([])
  })

  it('ligar o e-mail adicional COM endereço ativa form_email', () => {
    const out = detectNewlyActivatedRecipients({
      prev: prevBase,
      next: { notify_email_enabled: true, notify_email: EXTRA },
      ownerEmail: OWNER,
    })
    expect(out).toEqual([{ email: EXTRA, role: 'form_email' }])
  })

  it('ligar o e-mail adicional SEM endereço não ativa (destinatário não existe)', () => {
    expect(
      detectNewlyActivatedRecipients({
        prev: prevBase,
        next: { notify_email_enabled: true },
        ownerEmail: OWNER,
      })
    ).toEqual([])
  })

  it('digitar o endereço com a chave JÁ ligada é transição (caminho indireto)', () => {
    const out = detectNewlyActivatedRecipients({
      prev: { ...prevBase, notify_email_enabled: true, notify_email: null },
      next: { notify_email: EXTRA },
      ownerEmail: OWNER,
    })
    expect(out).toEqual([{ email: EXTRA, role: 'form_email' }])
  })

  it('trocar o endereço extra com chave ligada NÃO é transição (claims são por papel)', () => {
    expect(
      detectNewlyActivatedRecipients({
        prev: { ...prevBase, notify_email_enabled: true, notify_email: 'antigo@empresa.com' },
        next: { notify_email: EXTRA },
        ownerEmail: OWNER,
      })
    ).toEqual([])
  })

  it('canto: extra era IGUAL ao dono (deduplicado fora da lista) e passa a divergir — é transição', () => {
    const out = detectNewlyActivatedRecipients({
      prev: { ...prevBase, notify_email_enabled: true, notify_email: OWNER },
      next: { notify_email: EXTRA },
      ownerEmail: OWNER,
    })
    expect(out).toEqual([{ email: EXTRA, role: 'form_email' }])
  })

  it('religar o dono e ativar o extra no MESMO save ativa os dois', () => {
    const out = detectNewlyActivatedRecipients({
      prev: { ...prevBase, notify_owner_enabled: false },
      next: { notify_owner_enabled: true, notify_email_enabled: true, notify_email: EXTRA },
      ownerEmail: OWNER,
    })
    expect(out).toEqual([
      { email: OWNER, role: 'owner' },
      { email: EXTRA, role: 'form_email' },
    ])
  })

  it('dono sem e-mail no perfil nunca vira destinatário', () => {
    expect(
      detectNewlyActivatedRecipients({
        prev: { ...prevBase, notify_owner_enabled: false },
        next: { notify_owner_enabled: true },
        ownerEmail: '',
      })
    ).toEqual([])
  })
})

/** Mock chainable mínimo do client — grava as chamadas para inspeção. */
function makeClient(pages: Array<Array<{ id: string; answers: unknown; last_activity_at: string }>>, opts?: {
  selectError?: unknown
  upsertError?: unknown
}) {
  const upserts: Array<{ rows: Record<string, unknown>[]; options: Record<string, unknown> }> = []
  const selects: Array<Record<string, unknown>> = []
  let page = 0
  const client = {
    from(table: string) {
      if (table === 'responses') {
        const call: Record<string, unknown> = {}
        return {
          select: (cols: string) => { call.cols = cols; return {
            eq: (c1: string, v1: unknown) => { call[c1] = v1; return {
              eq: (c2: string, v2: unknown) => { call[c2] = v2; return {
                gt: (c3: string, v3: string) => { call[`gt:${c3}`] = v3; return {
                  lt: (c4: string, v4: string) => { call[`lt:${c4}`] = v4; return {
                    order: () => ({
                      limit: () => {
                        selects.push(call)
                        if (opts?.selectError) return Promise.resolve({ data: null, error: opts.selectError })
                        const data = pages[page] ?? []
                        page += 1
                        return Promise.resolve({ data, error: null })
                      },
                    }),
                  } },
                } },
              } },
            } },
          } },
        }
      }
      return {
        upsert: (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
          upserts.push({ rows, options })
          return Promise.resolve({ error: opts?.upsertError ?? null })
        },
      }
    },
  }
  return { client: client as unknown as BaselineClient, upserts, selects }
}

const RESP = (id: string, answers: unknown = { q1: 'oi' }) => ({
  id, answers, last_activity_at: '2026-08-05T18:00:00.000Z',
})

describe('baselineAbandonedEmailClaims', () => {
  const recipients = [{ email: EXTRA, role: 'form_email' as const }]

  it('sem destinatário novo, não toca o banco', async () => {
    const { client, upserts, selects } = makeClient([[RESP('r1')]])
    const out = await baselineAbandonedEmailClaims({ client, formId: 'f1', recipients: [], thresholdMin: 30 })
    expect(out).toEqual({ responses: 0, claimed: 0 })
    expect(selects).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('grava um claim terminal suprimido por (abandono × destinatário)', async () => {
    const { client, upserts } = makeClient([[RESP('r1'), RESP('r2')]])
    const out = await baselineAbandonedEmailClaims({
      client, formId: 'f1', thresholdMin: 30,
      recipients: [{ email: OWNER, role: 'owner' }, { email: EXTRA, role: 'form_email' }],
    })
    expect(out).toEqual({ responses: 2, claimed: 4 })
    expect(upserts).toHaveLength(1)
    const { rows, options } = upserts[0]
    expect(rows).toHaveLength(4)
    expect(options).toEqual({
      onConflict: 'response_id,event_type,channel,recipient_role',
      ignoreDuplicates: true,
    })
    const first = rows.find((r) => r.response_id === 'r1' && r.recipient_role === 'form_email')!
    expect(first).toMatchObject({
      form_id: 'f1',
      event_type: 'abandoned',
      channel: 'email',
      recipient_hash: recipientHash(EXTRA),
      status: 'sent',
      attempts: 0,
      provider_message_id: null,
      error_message: BASELINE_MARKER,
    })
  })

  it('resposta sem conteúdo não ganha claim (mesmo filtro do cron)', async () => {
    const { client, upserts } = makeClient([[RESP('vazia', {}), RESP('cheia')]])
    const out = await baselineAbandonedEmailClaims({ client, formId: 'f1', recipients, thresholdMin: 30 })
    expect(out).toEqual({ responses: 1, claimed: 1 })
    expect(upserts[0].rows.map((r) => r.response_id)).toEqual(['cheia'])
  })

  it('janela da consulta = [lookback 72h, agora-threshold), só incompletas do form', async () => {
    const now = Date.parse('2026-08-05T21:00:00.000Z')
    const { client, selects } = makeClient([[]])
    await baselineAbandonedEmailClaims({ client, formId: 'f1', recipients, thresholdMin: 30, now })
    expect(selects[0]).toMatchObject({
      form_id: 'f1',
      completed: false,
      'gt:last_activity_at': '2026-08-02T21:00:00.000Z',
      'lt:last_activity_at': '2026-08-05T20:30:00.000Z',
    })
  })

  it('falha de leitura ou de escrita lança (fail-closed no chamador)', async () => {
    const bad1 = makeClient([[RESP('r1')]], { selectError: { message: 'boom' } })
    await expect(
      baselineAbandonedEmailClaims({ client: bad1.client, formId: 'f1', recipients, thresholdMin: 30 })
    ).rejects.toThrow(/parciais/)
    const bad2 = makeClient([[RESP('r1')]], { upsertError: { message: 'boom' } })
    await expect(
      baselineAbandonedEmailClaims({ client: bad2.client, formId: 'f1', recipients, thresholdMin: 30 })
    ).rejects.toThrow(/claims/)
  })
})

describe('helpers canônicos (movidos do cron — comportamento preservado)', () => {
  it('recipientHash normaliza caixa e espaço', () => {
    expect(recipientHash(' Dono@Clinica.com ')).toBe(recipientHash('dono@clinica.com'))
  })
  it('hasAnsweredSomething exige conteúdo real', () => {
    expect(hasAnsweredSomething({ q1: '  ' })).toBe(false)
    expect(hasAnsweredSomething({ q1: [] })).toBe(false)
    expect(hasAnsweredSomething({ q1: 'oi' })).toBe(true)
    expect(hasAnsweredSomething(null)).toBe(false)
  })
})
