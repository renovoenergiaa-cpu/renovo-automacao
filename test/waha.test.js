// Adaptador do WAHA: formato dos eventos, assinatura, menu numerado e a jornada pelo servidor real.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verificarAssinatura, interpretar, montarMenu, criarCliente, variantesBR, idDoEvento } from '../src/waha.js'
import { criarServidor, WAHA } from '../src/server.js'
import { criarApp } from '../src/app.js'
import { abrirBanco } from '../src/db.js'
import { cfgTeste } from './apoio.js'

const SEGREDO = 'segredo-waha'
const TEL = '+5511999990001'
const assinar = (corpo, segredo = SEGREDO) => createHmac('sha512', segredo).update(corpo).digest('hex')
const evento = (payload, extra = {}) => ({ id: `evt_${payload.id}`, event: 'message.any', session: 'default', payload: { timestamp: Math.floor(Date.now() / 1000), fromMe: false, hasMedia: false, ...payload }, ...extra })

test('assinatura: HMAC-SHA512 do corpo bruto', () => {
  const corpo = '{"event":"message"}'
  assert.equal(verificarAssinatura(assinar(corpo), corpo, SEGREDO), true)
  assert.equal(verificarAssinatura(assinar(corpo, 'outro'), corpo, SEGREDO), false)
  assert.equal(verificarAssinatura(assinar(corpo), corpo + ' ', SEGREDO), false)
  assert.equal(verificarAssinatura(undefined, corpo, SEGREDO), false)
  assert.equal(verificarAssinatura(assinar(corpo, ''), corpo, ''), false) // sem segredo configurado, nada passa
})

test('interpretar: texto, mídia, vendedor, eco do próprio bot e o que não interessa', () => {
  const m = interpretar(evento({ id: 'a1', from: '5511999990001@c.us', body: 'oi', _data: { pushName: 'Joe' } }))
  assert.deepEqual({ tipo: m.tipo, id: m.id, telefone: m.telefone, nome: m.nomePerfil, entrada: m.entrada, origem: m.origem }, { tipo: 'mensagem', id: 'a1', telefone: TEL, nome: 'Joe', entrada: { tipo: 'texto', texto: 'oi' }, origem: null })

  assert.deepEqual(interpretar(evento({ id: 'a2', from: '5511999990001@c.us', hasMedia: true, media: { mimetype: 'image/jpeg' } })).entrada, { tipo: 'midia', midia: 'image' })
  assert.deepEqual(interpretar(evento({ id: 'a3', from: '5511999990001@c.us', hasMedia: true, media: { mimetype: 'application/pdf' } })).entrada, { tipo: 'midia', midia: 'document' })
  assert.deepEqual(interpretar(evento({ id: 'a4', from: '5511999990001@c.us', hasMedia: true })).entrada, { tipo: 'midia', midia: 'outra' })

  // Vendedor escreveu pelo celular: o bot sai. Mensagem enviada pela API é do próprio bot: ignora.
  assert.deepEqual(interpretar(evento({ id: 'b1', fromMe: true, source: 'app', to: '5511999990001@c.us', body: 'olá' })), { tipo: 'eco', telefone: TEL })
  assert.equal(interpretar(evento({ id: 'b2', fromMe: true, source: 'api', to: '5511999990001@c.us', body: 'olá' })), null)
  assert.equal(interpretar(evento({ id: 'b3', fromMe: true, to: '5511999990001@c.us', body: 'olá' })), null) // origem desconhecida: não pausa o bot

  assert.equal(interpretar(evento({ id: 'c1', from: '120363000000000000@g.us', body: 'oi' })), null) // grupo
  assert.equal(interpretar(evento({ id: 'c2', from: 'status@broadcast', body: 'oi' })), null)
  assert.equal(interpretar(evento({ id: 'c3', from: '5511999990001@c.us', body: '' })), null) // localização, contato...
  assert.equal(interpretar({ event: 'message.ack', payload: { id: 'x' } }), null)
})

test('interpretar: número escondido atrás de @lid e origem de anúncio', () => {
  const comNumero = interpretar(evento({ id: 'd1', from: '99887766@lid', body: 'oi', _data: { key: { remoteJidAlt: '5511999990001:7@s.whatsapp.net' } } }))
  assert.equal(comNumero.telefone, TEL)
  assert.equal(interpretar(evento({ id: 'd2', from: '99887766@lid', body: 'oi' })).telefone, '99887766@lid')

  const ad = interpretar(evento({ id: 'e1', from: '5511999990001@c.us', body: 'Olá', _data: { message: { extendedTextMessage: { contextInfo: { externalAdReply: { sourceId: '123', sourceUrl: 'https://fb.me/x', title: 'Solar', ctwaClid: 'abc' } } } } } }))
  assert.deepEqual(ad.origem, { tipo: 'ad', id: '123', url: 'https://fb.me/x', titulo: 'Solar', ctwa_clid: 'abc' })
  // Prévia de link comum também usa externalAdReply, mas sem identificador de anúncio.
  assert.equal(interpretar(evento({ id: 'e2', from: '5511999990001@c.us', body: 'veja', _data: { contextInfo: { externalAdReply: { title: 'Site' } } } })).origem, null)
})

test('variantes do celular brasileiro (com e sem o 9) e id de evento de versões antigas', () => {
  assert.deepEqual(variantesBR('+55 15 99876-5432'), ['+5515998765432', '+551598765432'])
  assert.deepEqual(variantesBR('+551598765432'), ['+5515998765432', '+551598765432'])
  assert.deepEqual(variantesBR('+14155550100'), ['+14155550100'])
  assert.equal(idDoEvento({ event: 'message.any', payload: { id: 'abc' } }), 'message.any:abc')
  assert.equal(idDoEvento({ event: 'session.status', payload: {} }), undefined)
})

test('cliente: menu numerado, PDF em base64, chave no cabeçalho e repetição em erro 5xx', async () => {
  const pedidos = []
  let falhar = 1
  const fetch = async (url, init) => {
    pedidos.push({ url, chave: init.headers['X-Api-Key'], corpo: JSON.parse(init.body) })
    if (falhar-- > 0) return { ok: false, status: 503, text: async () => 'reiniciando' }
    return { ok: true, json: async () => ({ id: 'true_x' }) }
  }
  const wa = criarCliente({ url: 'http://waha:3000/', apiKey: 'k', instrucao: 'Responda com o número.', fetch, espera: async () => {} })

  await wa.opcoes(TEL, { texto: 'Que tipo de imóvel é?', opcoes: [{ id: 'imovel:casa', titulo: 'Casa' }, { id: 'imovel:comercio', titulo: 'Comércio' }], rodape: 'Para sair, digite PARAR' })
  assert.equal(pedidos.length, 2) // 503 e depois sucesso
  assert.deepEqual(pedidos[1], { url: 'http://waha:3000/api/sendText', chave: 'k', corpo: { session: 'default', chatId: '5511999990001@c.us', text: 'Que tipo de imóvel é?\n\n*1.* Casa\n*2.* Comércio\n\nResponda com o número.\nPara sair, digite PARAR' } })

  const arquivo = join(mkdtempSync(join(tmpdir(), 'waha-')), 'e.pdf')
  writeFileSync(arquivo, '%PDF-teste')
  await wa.documento('99887766@lid', { caminho: arquivo, nome: 'Estimativa.pdf', legenda: 'Estimativa nº 1' })
  assert.deepEqual(pedidos[2].corpo, { session: 'default', chatId: '99887766@lid', file: { mimetype: 'application/pdf', filename: 'Estimativa.pdf', data: Buffer.from('%PDF-teste').toString('base64') }, caption: 'Estimativa nº 1' })

  assert.equal(montarMenu({ texto: 'P', opcoes: [{ titulo: 'A' }] }, ''), 'P\n\n*1.* A')
})

test('servidor com WAHA: jornada por menu numerado e vendedor assumindo', async () => {
  const enviados = []
  const fetch = async (url, init) => (enviados.push(JSON.parse(init.body).text), { ok: true, json: async () => ({}) })
  const db = abrirBanco()
  const cfg = cfgTeste()
  const app = criarApp({
    db, cfg, interpretar, log: { error() {}, warn() {} },
    wa: criarCliente({ url: 'http://waha', apiKey: 'k', instrucao: cfg.textos.instrucao_menu, fetch, espera: async () => {} }),
    opcoes: { numerosTeste: [TEL], dirPropostas: mkdtempSync(join(tmpdir(), 'waha-srv-')) },
  })
  const servidor = criarServidor({ app, db, segredo: SEGREDO, provedor: WAHA })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${servidor.address().port}`
  const postar = (ev, segredo = SEGREDO) => {
    const corpo = JSON.stringify(ev)
    return globalThis.fetch(base + '/webhook/waha', { method: 'POST', headers: { 'X-Webhook-Hmac': assinar(corpo, segredo) }, body: corpo })
  }
  const ate = async (n) => { for (let i = 0; i < 200 && enviados.length < n; i++) await new Promise((r) => setTimeout(r, 10)) }
  try {
    assert.equal((await postar(evento({ id: 'm0', from: '5511999990001@c.us', body: 'oi' }), 'errado')).status, 401)
    assert.equal((await postar(evento({ id: 'm1', from: '5511999990001@c.us', body: 'oi' }))).status, 200)
    await ate(2)
    assert.match(enviados[1], /Em qual cidade[\s\S]*\*1\.\* Cidade Exemplo A[\s\S]*Responda com o número/)

    await postar(evento({ id: 'm2', from: '5511999990001@c.us', body: ' 2 ' })) // "2" = segunda cidade do menu
    await ate(3)
    assert.equal(db.conversa(TEL).estado.dados.cidade, 'Cidade Exemplo B')
    assert.match(enviados[2], /tipo de imóvel/)

    await postar(evento({ id: 'm3', from: '5511999990001@c.us', body: '99' })) // fora do menu: não vira opção
    await ate(4)
    assert.equal(db.conversa(TEL).estado.dados.imovel, undefined)

    const antes = enviados.length
    await postar(evento({ id: 'm4', fromMe: true, source: 'api', to: '5511999990001@c.us', body: 'pergunta do bot' }))
    await postar(evento({ id: 'm5', fromMe: true, source: 'app', to: '5511999990001@c.us', body: 'Oi, aqui é o vendedor' }))
    await postar(evento({ id: 'm6', from: '5511999990001@c.us', body: '1' }))
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(db.conversa(TEL).estado.status, 'humano')
    assert.equal(enviados.length, antes) // com o vendedor na conversa, o bot fica calado
  } finally {
    await new Promise((r) => servidor.close(r))
  }
})
