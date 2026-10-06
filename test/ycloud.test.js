// Contrato com a YCloud. Os payloads abaixo seguem os exemplos da documentação oficial (docs.ycloud.com, consultada em 2026-10-04).
// SIMULADO: nenhuma chamada real à API é feita aqui.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificarAssinatura, interpretar, montarInterativo, criarCliente, e164 } from '../src/ycloud.js'

const SEGREDO = 'whsec_teste'
const assinar = (corpo, t, segredo = SEGREDO) => `t=${t},s=${createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}`

test('assinatura do webhook: aceita a correta e recusa adulteração, segredo errado, formato inválido e evento antigo', () => {
  const corpo = '{"id":"evt_1","type":"whatsapp.inbound_message.received"}'
  const agora = 1_800_000_000_000
  const t = agora / 1000
  assert.equal(verificarAssinatura(assinar(corpo, t), corpo, SEGREDO, { agora }), true)
  assert.equal(verificarAssinatura(assinar(corpo, t), corpo + ' ', SEGREDO, { agora }), false)
  assert.equal(verificarAssinatura(assinar(corpo, t, 'outro'), corpo, SEGREDO, { agora }), false)
  assert.equal(verificarAssinatura(assinar(corpo, t - 3600), corpo, SEGREDO, { agora }), false) // repetição de evento antigo
  assert.equal(verificarAssinatura(undefined, corpo, SEGREDO, { agora }), false)
  assert.equal(verificarAssinatura('t=1,s=xyz', corpo, SEGREDO, { agora }), false)
  assert.equal(verificarAssinatura(assinar(corpo, t), corpo, '', { agora }), false) // sem segredo configurado nada passa
})

const recebida = (extra) => ({
  id: 'evt_1', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
  whatsappInboundMessage: {
    id: '63f8', wamid: 'wamid.HBgNODi', wabaId: 'WABA', from: '+5511999990001', to: '+5511888880000',
    customerProfile: { name: 'Joe' }, sendTime: '2026-10-05T15:00:00.000Z', ...extra,
  },
})

test('interpreta texto, clique em botão, clique em lista e mídia', () => {
  assert.deepEqual(interpretar(recebida({ type: 'text', text: { body: 'OK' } })).entrada, { tipo: 'texto', texto: 'OK' })
  const botao = recebida({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'imovel:casa', title: 'Casa' } } })
  assert.deepEqual(interpretar(botao).entrada, { tipo: 'opcao', id: 'imovel:casa' })
  const lista = recebida({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'conta:300a500', title: 'R$ 300 a R$ 500' } } })
  assert.deepEqual(interpretar(lista).entrada, { tipo: 'opcao', id: 'conta:300a500' })
  assert.deepEqual(interpretar(recebida({ type: 'audio', audio: { id: '7' } })).entrada, { tipo: 'midia', midia: 'audio' })
  const m = interpretar(recebida({ type: 'text', text: { body: 'oi' } }))
  assert.equal(m.telefone, '+5511999990001')
  assert.equal(m.id, 'wamid.HBgNODi')
  assert.equal(m.nomePerfil, 'Joe')
  assert.equal(m.origem, null) // sem dado de anúncio, não inventa origem
})

test('origem do anúncio vem só do campo referral da Meta', () => {
  const m = interpretar(recebida({
    type: 'text', text: { body: 'Olá' },
    referral: { source_url: 'https://fb.me/xxx', source_type: 'ad', source_id: '1202', headline: 'Energia solar', ctwa_clid: 'abc' },
  }))
  assert.deepEqual(m.origem, { tipo: 'ad', id: '1202', url: 'https://fb.me/xxx', titulo: 'Energia solar', ctwa_clid: 'abc' })
})

test('reações e mensagens de sistema são ignoradas; eco do app e status são reconhecidos', () => {
  assert.equal(interpretar(recebida({ type: 'reaction', reaction: { emoji: '👍' } })), null)
  assert.equal(interpretar({ type: 'whatsapp.template.reviewed' }), null)
  const eco = { type: 'whatsapp.smb.message.echoes', whatsappMessage: { from: '+5511888880000', to: '5511999990001', type: 'text' } }
  assert.deepEqual(interpretar(eco), { tipo: 'eco', telefone: '+5511999990001' })
  const status = { type: 'whatsapp.message.updated', whatsappMessage: { status: 'delivered', externalId: 'proposta:7' } }
  assert.deepEqual(interpretar(status), { tipo: 'status', externalId: 'proposta:7', status: 'delivered', erro: undefined, codigo: undefined })
  assert.equal(interpretar({ type: 'whatsapp.message.updated', whatsappMessage: { status: 'sent' } }), null) // sem a nossa marca e sem falha: não interessa
  const recusada = { type: 'whatsapp.message.updated', whatsappMessage: { status: 'failed', errorCode: '131031', errorMessage: 'Business account has been locked.' } }
  assert.deepEqual(interpretar(recusada), { tipo: 'status', externalId: null, status: 'failed', erro: 'Business account has been locked.', codigo: '131031' })
})

test('até 3 opções viram botões; 4 a 10 viram lista; fora do limite falha antes de enviar', () => {
  const op = (n, titulo = 'Opção') => Array.from({ length: n }, (_, i) => ({ id: `x:${i}`, titulo: `${titulo} ${i}` }))
  const b = montarInterativo({ texto: 'Pergunta', opcoes: op(3) })
  assert.equal(b.type, 'button')
  assert.deepEqual(b.action.buttons[0], { type: 'reply', reply: { id: 'x:0', title: 'Opção 0' } })
  const l = montarInterativo({ texto: 'Pergunta', opcoes: op(7), botao: 'Ver opções', rodape: 'rodapé' })
  assert.equal(l.type, 'list')
  assert.equal(l.action.sections[0].rows.length, 7)
  assert.deepEqual(l.footer, { text: 'rodapé' })
  assert.throws(() => montarInterativo({ texto: 'P', opcoes: [{ id: 'a', titulo: 'x'.repeat(21) }] }), /20 caracteres/)
  assert.throws(() => montarInterativo({ texto: 'P', opcoes: op(11), botao: 'Ver' }), /mais de 10/)
  assert.throws(() => montarInterativo({ texto: 'P', opcoes: op(5) }), /botão da lista/)
  assert.throws(() => montarInterativo({ texto: 'P', opcoes: op(4, 'x'.repeat(24)), botao: 'Ver' }), /24 caracteres/)
})

/** fetch falso: registra as chamadas e devolve as respostas da fila (ou 200 {id}). */
function fetchFalso(fila = []) {
  const chamadas = []
  const f = async (url, init) => {
    chamadas.push({ url, init })
    const r = fila.shift() ?? { status: 200, corpo: { id: 'ok', wamid: 'wamid.x', status: 'accepted' } }
    if (r instanceof Error) throw r
    return { ok: r.status < 300, status: r.status, json: async () => r.corpo, text: async () => JSON.stringify(r.corpo ?? {}) }
  }
  return { f, chamadas }
}
const cliente = (fila) => {
  const { f, chamadas } = fetchFalso(fila)
  return { wa: criarCliente({ apiKey: 'chave-secreta', numero: '5511888880000', fetch: f, espera: async () => {} }), chamadas }
}

test('envio de texto e de opções segue o formato do sendDirectly', async () => {
  const { wa, chamadas } = cliente()
  await wa.texto('+5511999990001', 'Olá')
  await wa.opcoes('+5511999990001', { texto: 'Tipo?', opcoes: [{ id: 'imovel:casa', titulo: 'Casa' }] })
  assert.equal(chamadas[0].url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly')
  assert.equal(chamadas[0].init.headers['X-API-Key'], 'chave-secreta')
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { from: '+5511888880000', to: '+5511999990001', type: 'text', text: { body: 'Olá' } })
  const corpo = JSON.parse(chamadas[1].init.body)
  assert.equal(corpo.type, 'interactive')
  assert.equal(corpo.interactive.action.buttons[0].reply.id, 'imovel:casa')
})

test('documento: sobe o arquivo como mídia (sem link público) e envia pelo id', async () => {
  const arq = join(mkdtempSync(join(tmpdir(), 'yc-')), 'x.pdf')
  writeFileSync(arq, '%PDF-1.4 teste')
  const { wa, chamadas } = cliente([{ status: 200, corpo: { id: 'MIDIA1' } }])
  await wa.documento('+5511999990001', { caminho: arq, nome: 'Estimativa.pdf', legenda: 'Sua estimativa', externalId: 'proposta:1' })
  assert.equal(chamadas[0].url, 'https://api.ycloud.com/v2/whatsapp/media/%2B5511888880000/upload')
  assert.ok(chamadas[0].init.body instanceof FormData)
  assert.equal(chamadas[0].init.body.get('file').name, 'Estimativa.pdf')
  assert.deepEqual(JSON.parse(chamadas[1].init.body), {
    from: '+5511888880000', to: '+5511999990001', externalId: 'proposta:1', type: 'document',
    document: { id: 'MIDIA1', filename: 'Estimativa.pdf', caption: 'Sua estimativa' },
  })
})

test('retentativas: repete em 5xx, 429 e erro de rede; não repete em erro do pedido', async () => {
  const ok = cliente([{ status: 503 }, new Error('rede caiu'), { status: 200, corpo: { id: 'ok' } }])
  await ok.wa.texto('+55', 'x')
  assert.equal(ok.chamadas.length, 3)

  const limite = cliente([{ status: 429 }, { status: 200, corpo: { id: 'ok' } }])
  await limite.wa.texto('+55', 'x')
  assert.equal(limite.chamadas.length, 2)

  const pedidoRuim = cliente([{ status: 400, corpo: { error: 'invalid' } }])
  await assert.rejects(pedidoRuim.wa.texto('+55', 'x'), /400/)
  assert.equal(pedidoRuim.chamadas.length, 1)

  const esgotou = cliente([{ status: 500 }, { status: 500 }, { status: 500 }])
  await assert.rejects(esgotou.wa.texto('+55', 'x'), /500/)
  assert.equal(esgotou.chamadas.length, 3) // para na terceira
})

test('a chave da API não aparece na mensagem de erro', async () => {
  const { wa } = cliente([{ status: 401, corpo: { error: 'unauthorized' } }])
  await assert.rejects(wa.texto('+55', 'x'), (e) => !String(e.message).includes('chave-secreta'))
})

test('e164 normaliza telefones', () => {
  assert.equal(e164('55 (11) 99999-0001'), '+5511999990001')
  assert.equal(e164('+5511999990001'), '+5511999990001')
})
