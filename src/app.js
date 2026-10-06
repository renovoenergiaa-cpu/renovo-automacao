// Orquestração: evento de webhook -> estado persistido -> mensagens enviadas.
// Regras de conversa ficam em funil.js; formato do provedor, em ycloud.js.
import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { passo, pergunta } from './funil.js'
import { usoReal } from './orcamento.js'
import { interpretar as interpretarPadrao } from './ycloud.js'
import { gerarPdf as gerarPdfPadrao, documentoDaProposta, numeroProposta, VERSAO_TEMPLATE } from './pdf.js'

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA
const ORDEM_ENTREGA = ['accepted', 'sent', 'delivered', 'read']

export const PADROES = {
  numerosTeste: [], // recebem resposta mesmo com dados fictícios e sem anúncio
  botSemAnuncio: false, // false = custo zero: o bot só fala dentro da janela gratuita aberta por anúncio
  lembretesMin: [30, 20 * 60], // minutos de silêncio do cliente para o 1º e o 2º lembrete
  janelaServicoH: 24, // depois disso o WhatsApp só aceita modelos pré-aprovados
  janelaGratisH: 72, // janela de ponto de entrada gratuito (anúncio de clique para o WhatsApp)
  retornoH: 6, // silêncio a partir do qual tratamos a volta como retomada
  humanoExpiraDias: 7, // sem atividade por esse tempo, um novo contato volta ao bot
  horaInicio: 8, // lembretes só neste intervalo (horário de Brasília)
  horaFim: 20,
  retencaoDias: 180, // PENDENTE DE VALIDAÇÃO (LGPD): prazo para apagar conversas e propostas
  dirPropostas: 'data/propostas',
}

const mascarar = (tel) => `…${String(tel).slice(-4)}`
const horaLocal = (ms) => Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(new Date(ms)))

export function criarApp({ db, wa, cfg, opcoes = {}, agora = () => Date.now(), log = console, notificar = async () => {}, gerarPdf = gerarPdfPadrao, interpretar = interpretarPadrao }) {
  const o = { ...PADROES, ...opcoes }
  const real = usoReal(cfg.parametros, cfg.empresa)
  const filas = new Map()
  const avisosDeFalha = new Map() // conversa -> último aviso, para não repetir a cada mensagem recusada

  // ponytail: fila em memória por telefone — serve para 1 processo; com mais de uma instância, trocar por trava no banco.
  function emFila(chave, fn) {
    const atual = (filas.get(chave) ?? Promise.resolve()).then(fn)
    const guarda = atual.catch(() => {})
    filas.set(chave, guarda)
    guarda.then(() => filas.get(chave) === guarda && filas.delete(chave))
    return atual
  }

  const avisarEquipe = (texto) => notificar(texto).catch((e) => log.error('notificação falhou:', e.message))
  const evento = (c, tipo, dados) => db.evento(c.id, tipo, dados, agora())
  const ehTeste = (tel) => o.numerosTeste.includes(tel)
  const gratis = (c, t) => c.gratis_ate != null && t < c.gratis_ate
  const podeFalar = (c, t) => ehTeste(c.telefone) || o.botSemAnuncio || gratis(c, t)

  /** Entrada do webhook. Grava o evento antes de qualquer trabalho; repetição devolve false. */
  function receber(ev) {
    if (!ev?.id || !db.guardarRecebido(ev.id, JSON.stringify(ev), agora())) return { novo: false, feito: Promise.resolve() }
    return { novo: true, feito: processar(ev.id, ev) }
  }

  async function processar(id, ev) {
    try {
      const m = interpretar(ev)
      if (m) await emFila(m.telefone ?? 'status', () => tratar(m))
      db.marcarProcessado(id, agora())
    } catch (e) {
      db.marcarErro(id, String(e?.message ?? e).slice(0, 300))
      log.error(`evento ${id} falhou:`, e?.message ?? e)
    }
  }

  function tratar(m) {
    if (m.tipo === 'mensagem') return tratarMensagem(m)
    if (m.tipo === 'eco') return tratarEco(m)
    if (m.tipo === 'status') return tratarStatus(m)
  }

  async function tratarMensagem(m) {
    if (db.mensagemVista(m.id)) return // mesma mensagem reentregue em outro evento
    const t = agora()

    // Bloqueio de uso real: com tabela fictícia ou empresa provisória, só números de teste são atendidos.
    if (!real && !ehTeste(m.telefone)) {
      db.registrarMensagem(m.id, t)
      log.warn(`mensagem de ${mascarar(m.telefone)} ignorada: parâmetros não aprovados (modo de teste).`)
      return
    }

    const c = db.conversa(m.telefone) ?? db.novaConversa(m.telefone, t)
    const ultimaAtividade = Math.max(c.cliente_em ?? 0, c.humano_em ?? 0)
    const inativoH = c.cliente_em ? (t - c.cliente_em) / HORA : 0
    if (m.origem) c.gratis_ate = t + o.janelaGratisH * HORA
    c.nome_perfil = m.nomePerfil ?? c.nome_perfil
    c.cliente_em = t
    c.lembretes = 0

    const semResposta = (motivo) => {
      const novo = c.estado.status !== 'humano'
      c.estado = { ...c.estado, status: 'humano', auto: motivo } // "auto": ninguém assumiu de fato; um clique em anúncio devolve ao bot
      c.humano_em ??= t
      db.transacao(() => {
        db.registrarMensagem(m.id, t)
        db.salvarConversa(c, t)
        if (novo) evento(c, 'handoff', { motivo })
      })
      if (novo) avisarEquipe(`Conversa para atendimento humano (${motivo}), telefone final ${m.telefone.slice(-4)}.`)
    }

    if (c.estado.status === 'humano') {
      const voltouPeloAnuncio = m.origem && c.estado.auto
      if (!voltouPeloAnuncio && t - ultimaAtividade < o.humanoExpiraDias * DIA) {
        db.transacao(() => { db.registrarMensagem(m.id, t); db.salvarConversa(c, t) })
        return // bot pausado: quem responde é o vendedor
      }
      c.estado = {} // atendimento antigo: começa uma conversa nova
    }
    if (db.ajuste('pausado') === '1') return semResposta('bot_pausado')
    if (m.em && t - m.em > (o.janelaServicoH - 1) * HORA) return semResposta('mensagem_antiga') // fora da janela de 24h
    if (!podeFalar(c, t)) return semResposta('sem_anuncio') // fora da janela gratuita: responder custaria

    const ctx = { ...cfg, nomePerfil: c.nome_perfil, retorno: inativoH >= o.retornoH }
    // Resposta "2" vale como toque na 2ª opção da última pergunta enviada (no WAHA não há botões, só menu numerado).
    const n = m.entrada.tipo === 'texto' && /^\s*\d{1,2}\s*$/.test(m.entrada.texto) && Number(m.entrada.texto)
    const entrada = n && c.estado.menu?.[n - 1] ? { tipo: 'opcao', id: c.estado.menu[n - 1] } : m.entrada
    const r = passo(c.estado, entrada, ctx)
    c.estado = r.conv
    const eventos = r.acoes.filter((a) => a.tipo === 'evento')
    if (eventos.some((e) => e.nome === 'conversa_iniciada')) {
      c.id = randomUUID() // cada conversa nova conta separadamente no funil
      c.criada_em = t
      c.origem = m.origem // origem é a da mensagem que abriu ESTA conversa; sem dado da Meta, fica nula
    } else c.origem ??= m.origem
    if (c.estado.status === 'humano') c.humano_em = t

    // Estado e deduplicação gravados juntos, antes de enviar: uma reentrega não repete respostas.
    db.transacao(() => {
      db.registrarMensagem(m.id, t)
      db.salvarConversa(c, t)
      for (const e of eventos) evento(c, e.nome, e.nome === 'conversa_iniciada' ? { anuncio: c.origem?.id ?? null, origem: c.origem?.tipo ?? null } : e.dados)
    })
    await executar(c, r.acoes.filter((a) => a.tipo !== 'evento'))
  }

  async function executar(c, acoes) {
    let menu // ids das opções da última pergunta que saiu; sem pergunta nova, o menu antigo deixa de valer
    for (const a of acoes) {
      try {
        if (a.tipo === 'texto') await wa.texto(c.telefone, a.texto, `conv:${c.id}`)
        else if (a.tipo === 'opcoes') {
          await wa.opcoes(c.telefone, a, `conv:${c.id}`)
          menu = a.opcoes.map((x) => x.id)
        } else if (a.tipo === 'proposta') await enviarProposta(c, a.orcamento)
        else if (a.tipo === 'humano') avisarEquipe(`Atendimento humano solicitado (${a.motivo}), telefone final ${c.telefone.slice(-4)}${c.estado.dados?.cidade ? ', ' + c.estado.dados.cidade : ''}.`)
      } catch (e) {
        log.error(`falha ao enviar ${a.tipo} para ${mascarar(c.telefone)}:`, e?.message ?? e)
        if (a.tipo === 'proposta') await falhaNaProposta(c)
        else evento(c, 'falha_envio', { acao: a.tipo, etapa: c.estado.etapa }) // o lembrete refaz a pergunta atual
        break
      }
    }
    c.estado = { ...c.estado, menu }
    c.bot_em = agora()
    db.salvarConversa(c, agora())
  }

  async function enviarProposta(c, orcamento) {
    const d = c.estado.dados
    // Mesmos dados e mesma tabela = mesma proposta (não cria número novo nem duplica).
    const hash = createHash('sha256')
      .update(JSON.stringify([d.cidade, d.imovel, d.conta, d.telhado, d.nome, orcamento.versao_parametros, VERSAO_TEMPLATE]))
      .digest('hex').slice(0, 16)
    const existente = db.propostaPor(c.telefone, hash)
    const p = existente ?? db.criarProposta({ telefone: c.telefone, hash, conversa: c.id, dados: { cliente: d, orcamento, template: VERSAO_TEMPLATE }, criada_em: agora() })
    const numero = numeroProposta(p.numero, p.criada_em)
    const arquivo = join(o.dirPropostas, `estimativa-${numero}.pdf`)
    await gerarPdf(documentoDaProposta({ numero: p.numero, criadaEm: p.criada_em, cfg, dados: d, orcamento, real }), arquivo)
    db.atualizarProposta(p.numero, { arquivo })
    evento(c, 'proposta_gerada', { numero: p.numero, reaproveitada: !!existente, parametros: orcamento.versao_parametros })
    await wa.documento(c.telefone, {
      caminho: arquivo,
      nome: `Estimativa-${cfg.empresa.nome_curto}-${numero}.pdf`,
      legenda: cfg.textos.legenda_pdf.replace('{numero}', numero).replace('{empresa}', cfg.empresa.nome_curto),
      externalId: `proposta:${p.numero}`,
    })
    db.atualizarProposta(p.numero, { entrega: 'accepted' })
    evento(c, 'proposta_enviada', { numero: p.numero }) // enviada não é entregue, e entregue não é lida
  }

  async function falhaNaProposta(c) {
    c.estado = { ...c.estado, status: 'humano' }
    c.humano_em = agora()
    evento(c, 'proposta_falha', {})
    evento(c, 'handoff', { motivo: 'falha_pdf' })
    avisarEquipe(`FALHA ao gerar/enviar a estimativa, telefone final ${c.telefone.slice(-4)}. Enviar manualmente.`)
    const texto = cfg.textos.humano_falha.replace('{empresa}', cfg.empresa.nome_curto).replace('{horario}', cfg.empresa.horario_atendimento)
    await wa.texto(c.telefone, texto).catch((e) => log.error('nem o aviso de falha saiu:', e?.message ?? e))
  }

  /** O vendedor escreveu pelo app WhatsApp Business: o bot sai da conversa. */
  function tratarEco(m) {
    const t = agora()
    const c = db.conversa(m.telefone) ?? db.novaConversa(m.telefone, t)
    const novo = c.estado.status !== 'humano'
    c.estado = { ...c.estado, status: 'humano', auto: undefined }
    c.humano_em = t
    db.salvarConversa(c, t)
    if (novo) evento(c, 'handoff', { motivo: 'vendedor_assumiu' })
  }

  /** Recibos de entrega do PDF. A ordem de chegada não é garantida, por isso só avançamos. */
  function tratarStatus(m) {
    const [tipo, n] = (m.externalId ?? '').split(':')
    const p = tipo === 'proposta' && db.proposta(Number(n))
    if (!p) {
      // Mensagem comum do bot (pergunta, texto) recusada depois de aceita pela API: sem isto a falha passaria despercebida.
      if (m.status !== 'failed') return
      log.error(`mensagem NÃO entregue pela Meta: ${m.codigo ?? '?'} ${m.erro ?? ''}`.trim())
      const conversa = tipo === 'conv' ? n : 'desconhecida'
      evento({ id: conversa }, 'falha_entrega', { codigo: m.codigo ?? null })
      if (agora() - (avisosDeFalha.get(conversa) ?? 0) > 10 * MIN) {
        avisosDeFalha.set(conversa, agora())
        avisarEquipe(`A Meta recusou mensagens do bot (erro ${m.codigo ?? '?'}: ${m.erro ?? 'sem descrição'}). O cliente não recebeu a resposta: atender pelo app.`)
      }
      return
    }
    const c = { id: p.conversa }
    if (m.status === 'failed') {
      if (p.entrega === 'failed') return
      db.atualizarProposta(p.numero, { entrega: 'failed' })
      evento(c, 'proposta_falha_entrega', { numero: p.numero })
      avisarEquipe(`A estimativa nº ${p.numero} NÃO foi entregue (telefone final ${p.telefone.slice(-4)}).`)
      return
    }
    const [antes, depois] = [ORDEM_ENTREGA.indexOf(p.entrega), ORDEM_ENTREGA.indexOf(m.status)]
    if (depois <= antes) return
    db.atualizarProposta(p.numero, { entrega: m.status })
    if (antes < 2 && depois >= 2) evento(c, 'proposta_entregue', { numero: p.numero })
    if (depois === 3) evento(c, 'proposta_mensagem_lida', { numero: p.numero }) // mensagem lida no chat; não prova que o PDF foi aberto
  }

  async function lembrar(telefone) {
    const t = agora()
    const c = db.conversa(telefone)
    const e = c?.estado
    if (!e || e.status !== 'bot' || e.optout || !e.etapa || ['fim', 'fora'].includes(e.etapa)) return
    if (!podeFalar(c, t)) return // lembrete só enquanto for gratuito
    const parado = (t - c.cliente_em) / MIN
    if (parado >= o.janelaServicoH * 60 - 30) return // janela de 24h fechando: não arriscar
    const rodape = cfg.textos.rodape_lembrete
    let acoes
    if (e.etapa === 'pos') {
      if (e.sem_lembrete || c.lembretes >= 1 || parado < o.lembretesMin[1]) return
      acoes = [{ tipo: 'opcoes', texto: cfg.textos.lembrete_pos, rodape, opcoes: [
        { id: 'acao:consultor', titulo: cfg.textos.pos_consultor },
        { id: 'acao:parar', titulo: cfg.textos.lembrete_parar },
      ] }]
    } else {
      if (c.lembretes >= o.lembretesMin.length || parado < o.lembretesMin[c.lembretes]) return
      const refazer = pergunta(e, { ...cfg, nomePerfil: c.nome_perfil }).map((a) => (a.tipo === 'opcoes' ? { ...a, rodape } : a))
      acoes = [{ tipo: 'texto', texto: cfg.textos[`lembrete_${c.lembretes + 1}`] }, ...refazer]
    }
    c.lembretes += 1
    db.salvarConversa(c, t)
    evento(c, 'lembrete', { n: c.lembretes, etapa: e.etapa })
    await executar(c, acoes)
  }

  /** Chamado a cada minuto pelo servidor: reprocessa falhas, envia lembretes e aplica a retenção. */
  async function tique() {
    const t = agora()
    for (const r of db.pendentes(t - MIN)) await processar(r.id, JSON.parse(r.corpo))
    const h = horaLocal(t)
    if (db.ajuste('pausado') !== '1' && h >= o.horaInicio && h < o.horaFim)
      for (const tel of db.conversasComClienteDesde(t - o.janelaServicoH * HORA)) await emFila(tel, () => lembrar(tel)).catch((e) => log.error('lembrete falhou:', e?.message ?? e))
    if (t - Number(db.ajuste('purga_em') ?? 0) > DIA) {
      db.definirAjuste('purga_em', t)
      for (const arq of db.purgar(t - o.retencaoDias * DIA, t - 30 * DIA)) await rm(arq, { force: true })
    }
  }

  return { receber, tique, real }
}
