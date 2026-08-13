import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DUNNING_WHATSAPP_TEMPLATES } from './dunning-content'

type TemplateJson = {
  name: string
  language: string
  category: string
  components: Array<{
    type: string
    text?: string
    buttons?: Array<{ type: string; url?: string }>
  }>
}

// Contrato deliberadamente cruzado com o repositório que submete os templates à Meta. Uma
// cópia local poderia ficar verde enquanto o JSON real divergisse — exatamente o falso sinal
// que este teste existe para impedir.
const TEMPLATE_DIR = resolve(process.cwd(), '../eidos-atendente-wpp/campanhas/templates')

function readTemplate(name: string): TemplateJson {
  return JSON.parse(readFileSync(resolve(TEMPLATE_DIR, `${name}.json`), 'utf8')) as TemplateJson
}

function bodyParamCount(template: TemplateJson): number {
  const body = template.components.find((component) => component.type === 'BODY')
  return new Set(body?.text?.match(/\{\{\d+\}\}/g) ?? []).size
}

describe('contrato dos templates UTILITY reais da régua', () => {
  it.each([
    [DUNNING_WHATSAPP_TEMPLATES.cobranca, 3],
    [DUNNING_WHATSAPP_TEMPLATES.planoRebaixado, 2],
  ] as const)('%s: nome, categoria e componentes batem com o envio', (name, bodyParams) => {
    const template = readTemplate(name)

    expect(template.name).toBe(name)
    expect(template.language).toBe('pt_BR')
    expect(template.category).toBe('UTILITY')
    expect(template.components.map((component) => component.type)).toEqual(['BODY', 'BUTTONS'])
    expect(bodyParamCount(template)).toBe(bodyParams)

    const buttons = template.components.find((component) => component.type === 'BUTTONS')?.buttons
    expect(buttons).toHaveLength(1)
    expect(buttons?.[0]).toMatchObject({ type: 'URL', url: 'https://eidosform.com.br/pagar/{{1}}' })
  })
})
