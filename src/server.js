// Servidor HTTP: recebe os webhooks do provedor (WAHA ou YCloud) e roda o relógio de lembretes.
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { carregarConfig } from './config.js'
import { abrirBanco } from './db.js'
import * as ycloud from './ycloud.js'
import * as waha from './waha.js'
import { criarApp } from './app.js'

const LIMITE_CORPO = 1_000_000 // bytes
const YCLOUD = { caminho: '/webhook/ycloud', cabecalho: 'ycloud-signature', verificar: ycloud.verificarAssinatura }
export const WAHA = { caminho: '/webhook/waha', cabecalho: 'x-webhook-hmac', verificar: waha.verificarAssinatura, idDoEvento: waha.idDoEvento }

export function criarServidor({ app, db, segredo, provedor = YCLOUD }) {
  return createServer((req, res) => {
    const responder = (status, corpo = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(corpo))
    }
    if (req.method === 'GET' && req.url === '/saude')
      return responder(200, { ok: true, pendentes: db.contarPendentes(), pausado: db.ajuste('pausado') === '1', uso_real: app.real })
    if (req.method !== 'POST' || req.url !== provedor.caminho) return responder(404)

    const partes = []
    let tamanho = 0
    req.on('data', (parte) => {
      tamanho += parte.length
      if (tamanho > LIMITE_CORPO) {
        responder(413)
        req.destroy()
      } else partes.push(parte)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      const bruto = Buffer.concat(partes).toString('utf8')
      // A assinatura é conferida sobre o corpo bruto, antes de interpretar qualquer coisa.
      if (!provedor.verificar(req.headers[provedor.cabecalho], bruto, segredo)) return responder(401)
      let ev
      try {
        ev = JSON.parse(bruto)
      } catch {
        return responder(400)
      }
      if (ev && !ev.id) ev.id = provedor.idDoEvento?.(ev)
      app.receber(ev) // grava o evento e segue em segundo plano; o provedor espera uma resposta rápida
      responder(200, { ok: true })
    })
  })
}

function iniciar() {
  const env = process.env
  const usaWaha = !!env.WAHA_URL // WAHA_URL preenchido escolhe o WAHA; sem ele, vale a YCloud
  const exigidas = usaWaha ? ['WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET'] : ['YCLOUD_API_KEY', 'YCLOUD_WEBHOOK_SECRET', 'WHATSAPP_NUMERO']
  const faltando = exigidas.filter((v) => !env[v])
  if (faltando.length) {
    console.error(`Variáveis ausentes: ${faltando.join(', ')}. Copie .env.example para .env e preencha.`)
    process.exit(1)
  }
  process.umask(0o077) // banco e PDFs têm dados de clientes: só o usuário do serviço lê
  const cfg = carregarConfig()
  const dir = env.DADOS_DIR ?? 'data'
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = abrirBanco(join(dir, 'bot.sqlite'))
  const numerosTeste = (env.NUMEROS_TESTE ?? '').split(',').map((s) => s.trim()).filter(Boolean).flatMap(usaWaha ? waha.variantesBR : ycloud.e164)

  const notificar = async (texto) => {
    if (!env.NTFY_TOPICO) return
    // Aviso no celular da equipe. O texto não leva nome nem telefone completo do cliente.
    await fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPICO)}`, { method: 'POST', headers: { Title: cfg.empresa.nome_curto }, body: texto, signal: AbortSignal.timeout(10000) })
  }

  const app = criarApp({
    db,
    cfg,
    wa: usaWaha
      ? waha.criarCliente({ url: env.WAHA_URL, apiKey: env.WAHA_API_KEY, sessao: env.WAHA_SESSAO || 'default', instrucao: cfg.textos.instrucao_menu })
      : ycloud.criarCliente({ apiKey: env.YCLOUD_API_KEY, numero: env.WHATSAPP_NUMERO }),
    interpretar: usaWaha ? waha.interpretar : ycloud.interpretar,
    notificar,
    opcoes: { numerosTeste, botSemAnuncio: env.BOT_SEM_ANUNCIO === '1', dirPropostas: join(dir, 'propostas') },
  })

  if (!app.real && numerosTeste.length === 0) {
    console.error(
      'BLOQUEADO: a tabela de preços é fictícia (ou os dados da empresa são provisórios).\n' +
        'Para testar, defina NUMEROS_TESTE no .env. Para uso real, aprove config/parametros.json e config/empresa.json (ver docs/OPERACAO.md).',
    )
    process.exit(1)
  }
  if (!app.real) console.warn(`MODO DE TESTE: tabela ainda não aprovada. Só respondo aos números de teste; o PDF sai com marca d'água.`)

  const provedor = usaWaha ? WAHA : YCLOUD
  const servidor = criarServidor({ app, db, provedor, segredo: usaWaha ? env.WAHA_WEBHOOK_SECRET : env.YCLOUD_WEBHOOK_SECRET })
  const porta = Number(env.PORTA ?? 3000)
  servidor.listen(porta, () => console.log(`Bot no ar na porta ${porta}. Webhook: POST ${provedor.caminho} · Saúde: GET /saude`))
  const relogio = setInterval(() => app.tique().catch((e) => console.error('tique falhou:', e.message)), 60_000)

  for (const sinal of ['SIGINT', 'SIGTERM'])
    process.on(sinal, () => {
      clearInterval(relogio)
      servidor.close(() => {
        db.fechar()
        process.exit(0)
      })
    })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) iniciar()
