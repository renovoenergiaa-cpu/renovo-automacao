// Operação pelo terminal: métricas do funil, lista de leads, registro de venda, pausa e exclusão de dados.
// Uso: npm run cli -- <comando>   (comandos em docs/OPERACAO.md)
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { abrirBanco } from './db.js'
import { e164 } from './ycloud.js'

const PEDIDO_CONTATO = ['consultor', 'visita', 'duvida']
const conta = (obj, chave) => (obj[chave] = (obj[chave] ?? 0) + 1)

/** Funil por conversa (id aleatório), a partir dos eventos. Função pura, testada em test/app.test.js. */
export function relatorio(eventos) {
  const tem = (filtro) => new Set(eventos.filter(filtro).map((e) => e.conversa))
  const concluiu = (etapa) => (e) => e.tipo === 'etapa_concluida' && e.dados?.etapa === etapa
  const etapas = [
    ['Conversas iniciadas', tem((e) => e.tipo === 'conversa_iniciada')],
    ['Informou a cidade', tem(concluiu('cidade'))],
    ['Informou o imóvel', tem(concluiu('imovel'))],
    ['Informou a conta', tem(concluiu('conta'))],
    ['Qualificadas (estimativa automática)', tem((e) => e.tipo === 'qualificado')],
    ['Proposta enviada', tem((e) => e.tipo === 'proposta_enviada')],
    ['Proposta entregue', tem((e) => e.tipo === 'proposta_entregue')],
    ['Pediu contato', tem((e) => e.tipo === 'handoff' && PEDIDO_CONTATO.includes(e.dados?.motivo))],
    ['Venda', tem((e) => e.tipo === 'venda')],
  ]
  const inicio = etapas[0][1].size
  const funil = etapas.map(([nome, conj], i) => ({
    etapa: nome,
    conversas: conj.size,
    do_inicio: inicio ? Math.round((conj.size / inicio) * 100) : 0,
    da_anterior: i && etapas[i - 1][1].size ? Math.round((conj.size / etapas[i - 1][1].size) * 100) : 100,
  }))

  const motivos = {}
  const naoEntendido = {}
  const outros = {}
  for (const e of eventos) {
    if (e.tipo === 'handoff') conta(motivos, e.dados?.motivo ?? '?')
    else if (e.tipo === 'nao_entendido') conta(naoEntendido, e.dados?.etapa ?? '?')
    else if (['fora_area', 'optout', 'lembrete', 'clique_antigo', 'proposta_falha', 'falha_envio', 'proposta_mensagem_lida'].includes(e.tipo)) conta(outros, e.tipo)
  }

  // Por anúncio: só quando a Meta informou a origem. "sem_dado" não é atribuído a nada.
  const anuncioDe = new Map(eventos.filter((e) => e.tipo === 'conversa_iniciada').map((e) => [e.conversa, e.dados?.anuncio ?? 'sem_dado']))
  const porAnuncio = {}
  for (const [conversa, anuncio] of anuncioDe) {
    const a = (porAnuncio[anuncio] ??= { conversas: 0, propostas: 0, pedidos_contato: 0, vendas: 0, valor_vendido: 0 })
    a.conversas += 1
    if (etapas[5][1].has(conversa)) a.propostas += 1
    if (etapas[7][1].has(conversa)) a.pedidos_contato += 1
  }
  for (const e of eventos.filter((x) => x.tipo === 'venda')) {
    const a = porAnuncio[anuncioDe.get(e.conversa) ?? 'sem_dado']
    if (a) {
      a.vendas += 1
      a.valor_vendido += e.dados?.valor ?? 0
    }
  }
  return { funil, handoff_por_motivo: motivos, nao_entendido_por_etapa: naoEntendido, outros, por_anuncio: porAnuncio }
}

function principal([comando, ...args]) {
  const dir = process.env.DADOS_DIR ?? 'data'
  const db = abrirBanco(join(dir, 'bot.sqlite'))
  const conversaDe = (tel) => {
    const c = db.conversa(e164(tel ?? ''))
    if (!c) throw new Error(`não encontrei conversa para ${tel}`)
    return c
  }
  const agora = Date.now()

  switch (comando) {
    case 'relatorio': {
      const dias = Number(args[0] ?? 30)
      const r = relatorio(db.eventos(agora - dias * 86_400_000))
      console.log(`Funil dos últimos ${dias} dias (por conversa)`)
      console.table(r.funil)
      console.log('Encaminhamentos a pessoas, por motivo:', r.handoff_por_motivo)
      console.log('Respostas não entendidas, por etapa:', r.nao_entendido_por_etapa)
      console.log('Outros eventos:', r.outros)
      console.log('Por anúncio (origem informada pela Meta):')
      console.table(r.por_anuncio)
      break
    }
    case 'leads': {
      const csv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
      console.log(['telefone', 'nome', 'cidade', 'imovel', 'conta', 'telhado', 'etapa', 'status', 'anuncio', 'atualizada_em'].join(','))
      for (const c of db.conversas()) {
        const d = c.estado.dados ?? {}
        console.log([c.telefone, d.nome, d.cidade ?? d.cidade_fora, d.imovel, d.conta?.rotulo, d.telhado, c.estado.etapa, c.estado.status, c.origem?.id, new Date(c.atualizada_em).toISOString()].map(csv).join(','))
      }
      break
    }
    case 'venda': {
      const valor = Number(args[1])
      if (!(valor > 0)) throw new Error('uso: venda <telefone> <valor em reais>')
      db.evento(conversaDe(args[0]).id, 'venda', { valor }, agora)
      console.log('Venda registrada.')
      break
    }
    case 'perdido':
      db.evento(conversaDe(args[0]).id, 'perdido', { motivo: args.slice(1).join(' ') || null }, agora)
      console.log('Perda registrada.')
      break
    case 'pausar':
    case 'retomar':
      db.definirAjuste('pausado', comando === 'pausar' ? 1 : 0)
      console.log(comando === 'pausar' ? 'Bot pausado: novas mensagens ficam para a equipe, sem resposta automática.' : 'Bot retomado.')
      break
    case 'devolver': {
      const c = conversaDe(args[0])
      c.estado = { ...c.estado, status: 'bot', auto: undefined }
      db.salvarConversa(c, agora)
      console.log('Conversa devolvida ao bot.')
      break
    }
    case 'apagar': {
      const { arquivos, apagou } = db.apagarPessoa(e164(args[0] ?? ''))
      for (const a of arquivos) rmSync(a, { force: true })
      console.log(apagou ? `Dados apagados (${arquivos.length} PDF).` : 'Nenhum dado encontrado para esse telefone.')
      break
    }
    default:
      console.log('Comandos: relatorio [dias] | leads | venda <tel> <valor> | perdido <tel> [motivo] | pausar | retomar | devolver <tel> | apagar <tel>')
  }
  db.fechar()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    principal(process.argv.slice(2))
  } catch (e) {
    console.error('Erro:', e.message)
    process.exit(1)
  }
}
