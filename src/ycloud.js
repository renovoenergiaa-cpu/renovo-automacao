// Transporte: API oficial do WhatsApp via YCloud (https://docs.ycloud.com).
// É o único arquivo que conhece o formato do provedor: trocar de provedor é reescrever só este módulo.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const BASE = 'https://api.ycloud.com/v2'
const TENTATIVAS = 3
const LIMITE = { botao: 20, linha: 24, linhas: 10, botoes: 3, rodape: 60 }

export const e164 = (n) => '+' + String(n).replace(/\D/g, '')

/** Cabeçalho `YCloud-Signature: t=<unix>,s=<hmac-sha256 hex de "t.corpo">`. */
export function verificarAssinatura(cabecalho, corpoBruto, segredo, { toleranciaSeg = 300, agora = Date.now() } = {}) {
  const partes = Object.fromEntries(String(cabecalho ?? '').split(',').map((x) => x.trim().split('=')))
  if (!segredo || !partes.t || !/^[0-9a-f]{64}$/i.test(partes.s ?? '')) return false
  if (Math.abs(agora / 1000 - Number(partes.t)) > toleranciaSeg) return false // evita repetição de eventos antigos
  const esperado = createHmac('sha256', segredo).update(`${partes.t}.${corpoBruto}`).digest()
  return timingSafeEqual(Buffer.from(partes.s, 'hex'), esperado)
}

/** Evento de webhook -> forma neutra usada pelo app, ou null se não interessa. */
export function interpretar(ev) {
  if (ev?.type === 'whatsapp.inbound_message.received') {
    const m = ev.whatsappInboundMessage
    if (!m?.from || !m.wamid) return null
    if (['reaction', 'system', 'request_welcome'].includes(m.type)) return null
    const clique = m.interactive?.button_reply ?? m.interactive?.list_reply
    const entrada =
      m.type === 'text' ? { tipo: 'texto', texto: m.text?.body ?? '' }
      : m.type === 'button' ? { tipo: 'texto', texto: m.button?.text ?? '' }
      : clique?.id ? { tipo: 'opcao', id: clique.id }
      : { tipo: 'midia', midia: m.type }
    const r = m.referral
    return {
      tipo: 'mensagem',
      id: m.wamid,
      telefone: e164(m.from),
      nomePerfil: m.customerProfile?.name,
      entrada,
      // Só existe quando a Meta informa que a conversa veio de anúncio; nunca é deduzido.
      origem: r ? { tipo: r.source_type, id: r.source_id, url: r.source_url, titulo: r.headline, ctwa_clid: r.ctwa_clid } : null,
      em: Date.parse(m.sendTime) || null,
    }
  }
  if (ev?.type === 'whatsapp.smb.message.echoes') {
    const m = ev.whatsappMessage
    return m?.to ? { tipo: 'eco', telefone: e164(m.to) } : null // vendedor respondeu pelo app
  }
  if (ev?.type === 'whatsapp.message.updated') {
    const m = ev.whatsappMessage
    // Interessa o que tem a nossa marca (externalId) e toda falha de entrega, com ou sem marca.
    if (!m || !(m.externalId || m.status === 'failed')) return null
    return { tipo: 'status', externalId: m.externalId ?? null, status: m.status, erro: m.errorMessage, codigo: m.errorCode }
  }
  return null
}

/** Até 3 opções viram botões; de 4 a 10, lista. Fora dos limites do WhatsApp, falha antes de enviar. */
export function montarInterativo({ texto, opcoes, botao, rodape }) {
  const exigir = (ok, msg) => { if (!ok) throw new Error(`mensagem interativa inválida: ${msg}`) }
  exigir(!rodape || rodape.length <= LIMITE.rodape, 'rodapé longo')
  const comum = { body: { text: texto }, ...(rodape && { footer: { text: rodape } }) }
  if (opcoes.length <= LIMITE.botoes) {
    for (const o of opcoes) exigir(o.titulo.length <= LIMITE.botao, `botão "${o.titulo}" passa de ${LIMITE.botao} caracteres`)
    return { type: 'button', ...comum, action: { buttons: opcoes.map((o) => ({ type: 'reply', reply: { id: o.id, title: o.titulo } })) } }
  }
  exigir(opcoes.length <= LIMITE.linhas, `mais de ${LIMITE.linhas} opções`)
  exigir(botao && botao.length <= LIMITE.botao, 'texto do botão da lista ausente ou longo')
  for (const o of opcoes) exigir(o.titulo.length <= LIMITE.linha, `linha "${o.titulo}" passa de ${LIMITE.linha} caracteres`)
  return { type: 'list', ...comum, action: { button: botao, sections: [{ rows: opcoes.map((o) => ({ id: o.id, title: o.titulo })) }] } }
}

export function criarCliente({ apiKey, numero, fetch: buscar = fetch, espera = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const de = e164(numero)

  async function chamar(caminho, init) {
    let erro
    for (let i = 1; i <= TENTATIVAS; i++) {
      try {
        const r = await buscar(BASE + caminho, { ...init, headers: { 'X-API-Key': apiKey, ...init.headers }, signal: AbortSignal.timeout(20000) })
        if (r.ok) return await r.json()
        erro = Object.assign(new Error(`YCloud respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status })
        if (r.status < 500 && r.status !== 429) break // erro do pedido: repetir não resolve
      } catch (e) {
        erro = e // rede ou tempo esgotado
      }
      // ponytail: repetir depois de tempo esgotado pode duplicar uma mensagem que já tinha saído; preferimos isso a perdê-la.
      if (i < TENTATIVAS) await espera(500 * 4 ** (i - 1))
    }
    throw erro
  }

  const enviar = (para, corpo, externalId) =>
    chamar('/whatsapp/messages/sendDirectly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: de, to: para, ...(externalId && { externalId }), ...corpo }),
    })

  return {
    // externalId volta nos recibos de entrega: é como o bot fica sabendo se a Meta recusou a mensagem.
    texto: (para, texto, externalId) => enviar(para, { type: 'text', text: { body: texto } }, externalId),
    opcoes: (para, acao, externalId) => enviar(para, { type: 'interactive', interactive: montarInterativo(acao) }, externalId),
    /** Sobe o arquivo para a mídia do WhatsApp (sem link público) e envia como documento. */
    async documento(para, { caminho, nome, legenda, externalId }) {
      const form = new FormData()
      form.append('file', new Blob([await readFile(caminho)], { type: 'application/pdf' }), nome)
      const { id } = await chamar(`/whatsapp/media/${encodeURIComponent(de)}/upload`, { method: 'POST', body: form })
      return enviar(para, { type: 'document', document: { id, filename: nome, caption: legenda } }, externalId)
    },
  }
}
