// Cria (ou atualiza) na YCloud o webhook que aponta para este bot e grava o segredo no .env.
// Uso: node --env-file=.env scripts/registrar-webhook.js https://endereco-publico-do-bot
// Não imprime a chave da API nem o segredo.
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = 'https://api.ycloud.com/v2'
const EVENTOS = ['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes']
const DESCRICAO = 'renovo-bot' // identifica o endpoint criado por este script, para atualizar em vez de duplicar

const chave = process.env.YCLOUD_API_KEY
const publico = process.argv[2]?.replace(/\/+$/, '')
if (!chave) throw new Error('YCLOUD_API_KEY ausente no .env')
if (!/^https:\/\/[^/]+$/.test(publico ?? '')) throw new Error('informe o endereço público, ex.: https://exemplo.trycloudflare.com')
const url = `${publico}/webhook/ycloud`

async function api(metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'X-API-Key': chave, 'Content-Type': 'application/json' },
    body: corpo && JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`YCloud respondeu ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 200)}`)
  return j
}

const { items = [] } = await api('GET', '/webhookEndpoints')
const existente = items.find((e) => e.description === DESCRICAO)
const ep = existente
  ? await api('PATCH', `/webhookEndpoints/${existente.id}`, { url, enabledEvents: EVENTOS })
  : await api('POST', '/webhookEndpoints', { url, enabledEvents: EVENTOS, description: DESCRICAO })
if (!ep.secret) throw new Error('a YCloud não devolveu o segredo do endpoint; copie-o do painel para o .env')

const arquivo = new URL('../.env', import.meta.url)
const linhas = readFileSync(arquivo, 'utf8').split('\n')
const i = linhas.findIndex((l) => l.startsWith('YCLOUD_WEBHOOK_SECRET='))
const linha = `YCLOUD_WEBHOOK_SECRET=${ep.secret}`
if (i >= 0) linhas[i] = linha
else linhas.push(linha)
writeFileSync(arquivo, linhas.join('\n'), { mode: 0o600 })

console.log(`${existente ? 'Webhook atualizado' : 'Webhook criado'}: ${ep.id} -> ${url}`)
console.log('Eventos:', ep.enabledEvents.join(', '))
console.log('Segredo gravado no .env (não exibido).')
