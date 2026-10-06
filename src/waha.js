// Transporte: WAHA (https://waha.devlike.pro), API não oficial que controla um WhatsApp conectado por QR code.
// Mesma interface de ycloud.js. Não existem botões nem listas: as opções saem como menu numerado.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { e164 } from './ycloud.js'

const TENTATIVAS = 3
const PESSOA = /@(c\.us|s\.whatsapp\.net)$/

/** Cabeçalho `X-Webhook-Hmac`: HMAC-SHA512 (hex) do corpo bruto. */
export function verificarAssinatura(cabecalho, corpoBruto, segredo) {
  if (!segredo || !/^[0-9a-f]{128}$/i.test(cabecalho ?? '')) return false
  return timingSafeEqual(Buffer.from(cabecalho, 'hex'), createHmac('sha512', segredo).update(corpoBruto).digest())
}

/** Versões antigas do WAHA não mandam `id` no evento; sem ele o app descartaria a mensagem. */
export const idDoEvento = (ev) => (ev?.payload?.id ? `${ev.event}:${ev.payload.id}` : undefined)

/** Celulares do Brasil aparecem no WhatsApp com ou sem o 9 inicial: devolve as duas formas. */
export function variantesBR(numero) {
  const n = e164(numero)
  const m = n.match(/^\+55(\d\d)9?(\d{8})$/)
  return m ? [`+55${m[1]}9${m[2]}`, `+55${m[1]}${m[2]}`] : [n]
}

// ponytail: formato não conferido com mensagem real de anúncio; a posição muda por motor, por isso a busca em profundidade.
function anuncio(d, nivel = 0) {
  if (!d || typeof d !== 'object' || nivel > 8) return null
  const r = d.externalAdReply ?? d.ctwaContext
  if (r && (r.sourceId || r.ctwaClid)) return r
  for (const v of Object.values(d)) {
    const achado = anuncio(v, nivel + 1)
    if (achado) return achado
  }
  return null
}

/** Evento de webhook -> forma neutra usada pelo app, ou null se não interessa. */
export function interpretar(ev) {
  const p = ev?.payload
  if (!['message', 'message.any'].includes(ev?.event) || !p?.id) return null
  const chat = p.fromMe ? p.to : p.from
  if (!/@(c\.us|s\.whatsapp\.net|lid)$/.test(chat ?? '')) return null // grupos, status e canais
  // O WhatsApp pode esconder o número atrás de um id "@lid"; quando o número vem junto, usamos o número.
  // ponytail: sem o número, a conversa fica identificada pelo próprio "@lid" (o bot responde, mas relatórios e CLI mostram o id).
  const jid = [p._data?.key?.remoteJidAlt, chat].find((j) => PESSOA.test(j ?? ''))
  const telefone = jid ? e164(jid.split(/[:@]/)[0]) : chat

  if (p.fromMe) return p.source === 'app' ? { tipo: 'eco', telefone } : null // "api" = o próprio bot; "app" = vendedor no celular
  const tipoMidia = p.media?.mimetype ?? ''
  const entrada = p.hasMedia
    ? { tipo: 'midia', midia: tipoMidia.startsWith('image/') ? 'image' : /^(application|text)\//.test(tipoMidia) ? 'document' : 'outra' }
    : { tipo: 'texto', texto: p.body ?? '' }
  if (entrada.tipo === 'texto' && !entrada.texto.trim()) return null // localização, contato, mensagem apagada...
  const r = anuncio(p._data)
  return {
    tipo: 'mensagem',
    id: p.id,
    telefone,
    nomePerfil: p._data?.pushName ?? p._data?.notifyName ?? p._data?.Info?.PushName,
    entrada,
    origem: r ? { tipo: r.sourceType ?? 'ad', id: r.sourceId, url: r.sourceUrl, titulo: r.title, ctwa_clid: r.ctwaClid } : null,
    em: p.timestamp ? p.timestamp * 1000 : null,
  }
}

/** "Pergunta\n\n1. A\n2. B\n\n<instrução>": o cliente responde com o número (app.js traduz para a opção). */
export const montarMenu = ({ texto, opcoes, rodape }, instrucao) =>
  [texto, opcoes.map((o, i) => `*${i + 1}.* ${o.titulo}`).join('\n'), [instrucao, rodape].filter(Boolean).join('\n')].filter(Boolean).join('\n\n')

export function criarCliente({ url, apiKey, sessao = 'default', instrucao = '', pausaMs = 1200, fetch: buscar = fetch, espera = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = url.replace(/\/+$/, '')
  const chatId = (para) => (para.includes('@') ? para : `${para.replace(/\D/g, '')}@c.us`)

  async function enviar(caminho, para, corpo) {
    await espera(pausaMs) // rajada de mensagens instantâneas é o que mais derruba número em API não oficial
    let erro
    for (let i = 1; i <= TENTATIVAS; i++) {
      try {
        const r = await buscar(base + caminho, {
          method: 'POST',
          headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: sessao, chatId: chatId(para), ...corpo }),
          signal: AbortSignal.timeout(30000),
        })
        if (r.ok) return await r.json().catch(() => ({}))
        erro = Object.assign(new Error(`WAHA respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status })
        if (r.status < 500 && r.status !== 429) break // erro do pedido: repetir não resolve
      } catch (e) {
        erro = e // WAHA fora do ar ou tempo esgotado
      }
      if (i < TENTATIVAS) await espera(500 * 4 ** (i - 1))
    }
    throw erro
  }

  return {
    texto: (para, texto) => enviar('/api/sendText', para, { text: texto }),
    opcoes: (para, acao) => enviar('/api/sendText', para, { text: montarMenu(acao, instrucao) }),
    async documento(para, { caminho, nome, legenda }) {
      const data = (await readFile(caminho)).toString('base64')
      return enviar('/api/sendFile', para, { file: { mimetype: 'application/pdf', filename: nome, data }, caption: legenda })
    },
  }
}
