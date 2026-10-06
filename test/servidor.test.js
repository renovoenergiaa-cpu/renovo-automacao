// Servidor HTTP real em porta local, com requisições reais; só o WhatsApp é simulado.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarServidor } from '../src/server.js'
import { criarApp } from '../src/app.js'
import { abrirBanco } from '../src/db.js'
import { cfgTeste } from './apoio.js'

const SEGREDO = 'whsec_servidor'
const TEL = '+5511999990001'

async function subir() {
  const enviados = []
  const wa = { texto: async (p, t) => enviados.push(t), opcoes: async (p, a) => enviados.push(a.texto), documento: async () => enviados.push('doc') }
  const db = abrirBanco()
  const app = criarApp({ db, wa, cfg: cfgTeste(), log: { error() {}, warn() {} }, opcoes: { numerosTeste: [TEL], dirPropostas: mkdtempSync(join(tmpdir(), 'srv-')) } })
  const servidor = criarServidor({ app, db, segredo: SEGREDO })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${servidor.address().port}`
  const postar = (corpo, { segredo = SEGREDO, t = Math.floor(Date.now() / 1000), caminho = '/webhook/ycloud' } = {}) =>
    fetch(base + caminho, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${t},s=${createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}` },
      body: corpo,
    })
  return { base, postar, enviados, db, fechar: () => new Promise((r) => servidor.close(r)) }
}

const mensagem = (id) =>
  JSON.stringify({
    id, type: 'whatsapp.inbound_message.received',
    whatsappInboundMessage: { wamid: `wamid.${id}`, from: TEL, to: '+5511888880000', customerProfile: { name: 'Joe' }, sendTime: new Date().toISOString(), type: 'text', text: { body: 'oi' } },
  })
const esperar = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)) }

test('webhook assinado é aceito, processado e respondido; repetição não duplica', async () => {
  const s = await subir()
  try {
    const r = await s.postar(mensagem('evt_a'))
    assert.equal(r.status, 200)
    await esperar(() => s.enviados.length === 2)
    assert.match(s.enviados[0], /assistente virtual/)
    assert.equal((await s.postar(mensagem('evt_a'))).status, 200) // a YCloud reentrega: respondemos 200 e ignoramos
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(s.enviados.length, 2)
  } finally {
    await s.fechar()
  }
})

test('assinatura errada, evento antigo e corpo inválido são recusados sem processar', async () => {
  const s = await subir()
  try {
    assert.equal((await s.postar(mensagem('evt_b'), { segredo: 'errado' })).status, 401)
    assert.equal((await s.postar(mensagem('evt_c'), { t: Math.floor(Date.now() / 1000) - 3600 })).status, 401)
    assert.equal((await fetch(s.base + '/webhook/ycloud', { method: 'POST', body: mensagem('evt_d') })).status, 401) // sem cabeçalho
    assert.equal((await s.postar('{não é json')).status, 400)
    assert.equal((await s.postar(mensagem('evt_e'), { caminho: '/outro' })).status, 404)
    assert.equal(s.enviados.length, 0)
    assert.equal(s.db.contarPendentes(), 0)
  } finally {
    await s.fechar()
  }
})

test('corpo acima do limite é recusado', async () => {
  const s = await subir()
  try {
    const r = await s.postar(JSON.stringify({ id: 'evt_g', lixo: 'x'.repeat(1_100_000) })).catch(() => ({ status: 413 }))
    assert.equal(r.status, 413)
  } finally {
    await s.fechar()
  }
})

test('/saude informa pendências, pausa e se o uso real está liberado', async () => {
  const s = await subir()
  try {
    const r = await (await fetch(s.base + '/saude')).json()
    assert.deepEqual(r, { ok: true, pendentes: 0, pausado: false, uso_real: false })
  } finally {
    await s.fechar()
  }
})
