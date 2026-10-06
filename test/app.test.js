// Testes de ponta a ponta SIMULADOS: banco real (SQLite em memória), funil, orçamento e PDF reais;
// só o WhatsApp é falso (nenhuma mensagem sai de verdade). Relógio controlado pelo teste.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarApp } from '../src/app.js'
import { abrirBanco } from '../src/db.js'
import { cfgTeste } from './apoio.js'
import { montarInterativo } from '../src/ycloud.js'
import { relatorio } from '../src/cli.js'

const cfgFicticio = cfgTeste()
// Cópia "aprovada" só para testar o comportamento de produção; os valores continuam sendo os fictícios.
const cfgAprovado = {
  ...cfgFicticio,
  empresa: { ...cfgFicticio.empresa, provisorio: false },
  parametros: { ...cfgFicticio.parametros, meta: { ...cfgFicticio.parametros.meta, ficticio: false, aprovado: true, aprovado_por: 'Teste', aprovado_em: '2026-10-04' } },
}
const TEL = '+5511999990001'
const NUM = '+5511888880000'
const ANUNCIO = { source_type: 'ad', source_id: 'AD-123', source_url: 'https://fb.me/x', headline: 'Energia solar', ctwa_clid: 'clid' }
const mudo = { error() {}, warn() {}, log() {} }

function ambiente({ cfg = cfgFicticio, opcoes = {}, gerarPdf } = {}) {
  let relogio = Date.UTC(2026, 9, 5, 15, 0) // segunda-feira, 12h em Brasília
  let seq = 0
  const enviados = []
  const avisos = []
  const falhar = { texto: 0, opcoes: 0, documento: 0 }
  const tentar = (tipo) => { if (falhar[tipo]-- > 0) throw new Error(`falha simulada em ${tipo}`) }
  const wa = {
    texto: async (para, texto, externalId) => { tentar('texto'); enviados.push({ tipo: 'texto', para, texto, externalId }) },
    opcoes: async (para, a, externalId) => { tentar('opcoes'); montarInterativo(a); enviados.push({ tipo: 'opcoes', para, texto: a.texto, ids: a.opcoes.map((x) => x.id), rodape: a.rodape, externalId }) },
    documento: async (para, d) => { tentar('documento'); enviados.push({ tipo: 'documento', para, ...d }) },
  }
  const db = abrirBanco()
  const dir = mkdtempSync(join(tmpdir(), 'renovo-teste-'))
  const app = criarApp({
    db, wa, cfg, log: mudo, agora: () => relogio, notificar: async (t) => avisos.push(t),
    opcoes: { numerosTeste: [TEL], dirPropostas: dir, ...opcoes }, ...(gerarPdf && { gerarPdf }),
  })
  const evento = (conteudo, { tel = TEL, wamid, id, referral } = {}) => {
    seq += 1
    return {
      id: id ?? `evt_${seq}`, type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: { wamid: wamid ?? `wamid.${seq}`, from: tel, to: NUM, customerProfile: { name: 'Joe Silva' }, sendTime: new Date(relogio).toISOString(), ...conteudo, ...(referral && { referral }) },
    }
  }
  const a = {
    app, db, dir, enviados, avisos, falhar,
    texto: (t, o) => evento({ type: 'text', text: { body: t } }, o),
    clique: (id, o) => evento({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } }, o),
    audio: (o) => evento({ type: 'audio', audio: { id: '1' } }, o),
    async mandar(ev) { const r = app.receber(ev); await r.feito; return r.novo },
    async sequencia(...evs) { for (const ev of evs) await a.mandar(ev) },
    avancar: (min) => { relogio += min * 60_000 },
    conversa: (tel = TEL) => db.conversa(tel),
    eventos: () => db.eventos().map((e) => e.tipo),
    limpar: () => enviados.splice(0),
    /** Leva a conversa até a tela de confirmação. */
    ateConfirmar(o) {
      const mesmo = o?.tel && { tel: o.tel } // só a primeira mensagem carrega o dado do anúncio
      return a.sequencia(a.texto('oi', o), a.clique('cidade:cidade-exemplo-a', mesmo), a.clique('imovel:casa', mesmo), a.clique('conta:300a500', mesmo), a.clique('telhado:ceramica', mesmo))
    },
  }
  return a
}

test('jornada completa até o PDF', async () => {
  const a = ambiente()
  await a.ateConfirmar()
  await a.mandar(a.clique('confirmar:gerar'))

  assert.deepEqual(a.enviados.map((e) => e.tipo), [
    'texto', 'opcoes', // abertura + cidade
    'opcoes', 'opcoes', 'opcoes', 'opcoes', // imóvel, conta, telhado, confirmação
    'texto', 'documento', 'opcoes', // "preparando", PDF, próximo passo
  ])
  const doc = a.enviados.find((e) => e.tipo === 'documento')
  assert.equal(doc.nome, 'Estimativa-Renovo-2026-00001.pdf')
  assert.equal(doc.externalId, 'proposta:1')
  assert.equal(readFileSync(doc.caminho).subarray(0, 5).toString(), '%PDF-')
  assert.deepEqual(a.enviados.at(-1).ids, ['acao:consultor', 'acao:visita', 'pos:depois'])
  assert.equal(a.conversa().estado.etapa, 'pos')
  assert.deepEqual(a.eventos(), [
    'conversa_iniciada', 'etapa_concluida', 'etapa_concluida', 'etapa_concluida', 'etapa_concluida',
    'qualificado', 'proposta_gerada', 'proposta_enviada',
  ])
  assert.equal(a.db.proposta(1).entrega, 'accepted')
  assert.equal(a.db.contarPendentes(), 0)
})

test('eventos duplicados não geram respostas duplicadas', async () => {
  const a = ambiente()
  const ev = a.texto('oi')
  assert.equal(await a.mandar(ev), true)
  assert.equal(await a.mandar(ev), false) // mesmo id de evento (reentrega da YCloud)
  await a.mandar(a.texto('oi', { wamid: ev.whatsappInboundMessage.wamid })) // mesma mensagem dentro de outro evento
  assert.equal(a.enviados.length, 2) // só a abertura e a primeira pergunta
})

test('clique repetido ou atrasado em "Gerar estimativa" não cria segunda proposta', async () => {
  const a = ambiente()
  await a.ateConfirmar()
  await a.sequencia(a.clique('confirmar:gerar'), a.clique('confirmar:gerar'))
  assert.equal(a.enviados.filter((e) => e.tipo === 'documento').length, 1)
  assert.equal(a.db.todos('SELECT count(*) n FROM propostas')[0].n, 1)
  assert.match(a.enviados.at(-2).texto, /pergunta anterior/)
})

test('mesmos dados geram a mesma proposta; dados corrigidos geram número novo', async () => {
  const a = ambiente()
  await a.ateConfirmar()
  await a.mandar(a.clique('confirmar:gerar'))
  await a.sequencia(a.texto('corrigir'), a.clique('corrigir:conta'), a.clique('conta:300a500'), a.clique('confirmar:gerar'))
  let docs = a.enviados.filter((e) => e.tipo === 'documento')
  assert.deepEqual(docs.map((d) => d.externalId), ['proposta:1', 'proposta:1']) // reenviou a mesma
  await a.sequencia(a.texto('corrigir'), a.clique('corrigir:conta'), a.clique('conta:500a800'), a.clique('confirmar:gerar'))
  docs = a.enviados.filter((e) => e.tipo === 'documento')
  assert.equal(docs.at(-1).externalId, 'proposta:2')
})

test('lead fora da área atendida: registra o interesse e não envia PDF', async () => {
  const a = ambiente()
  await a.sequencia(a.texto('oi'), a.clique('cidade:outra'), a.texto('Lugar Distante'), a.clique('fora:avisar'))
  assert.ok(!a.enviados.some((e) => e.tipo === 'documento'))
  assert.deepEqual(a.eventos(), ['conversa_iniciada', 'fora_area', 'fora_area_interesse'])
  assert.equal(a.conversa().estado.etapa, 'fim')
})

test('respostas inesperadas e áudio recebem orientação; na segunda falha o bot chama uma pessoa e para', async () => {
  const a = ambiente()
  await a.sequencia(a.texto('oi'), a.audio())
  assert.match(a.enviados.at(-2).texto, /não consigo ouvir áudios/)
  assert.equal(a.enviados.at(-1).tipo, 'opcoes') // repete a pergunta
  await a.mandar(a.texto('asdf qwer'))
  assert.equal(a.conversa().estado.status, 'humano')
  assert.equal(a.avisos.length, 1)
  a.limpar()
  await a.mandar(a.texto('tem alguém aí?'))
  assert.equal(a.enviados.length, 0) // bot pausado
})

test('abandono: dois lembretes dentro de 24h, em horário comercial, e nunca um terceiro', async () => {
  const a = ambiente()
  await a.sequencia(a.texto('oi'), a.clique('cidade:cidade-exemplo-a'))
  a.limpar()
  a.avancar(29); await a.app.tique()
  assert.equal(a.enviados.length, 0)
  a.avancar(2); await a.app.tique() // 31 min
  assert.match(a.enviados[0].texto, /Falta pouco/)
  assert.deepEqual(a.enviados[1].ids, ['imovel:casa', 'imovel:comercio', 'imovel:apto']) // refaz a pergunta pendente
  assert.match(a.enviados[1].rodape, /PARAR/)
  await a.app.tique()
  assert.equal(a.enviados.length, 2) // não repete
  a.avancar(9 * 60); await a.app.tique() // 21h40 em Brasília: fora do horário e ainda antes das 20h de silêncio
  assert.equal(a.enviados.length, 2)
  a.avancar(11 * 60); await a.app.tique() // 8h41 do dia seguinte, 20h41 de silêncio
  assert.match(a.enviados[2].texto, /esperando por você/)
  a.avancar(60); await a.app.tique()
  assert.equal(a.enviados.length, 4) // 2 lembretes (texto + pergunta); sem terceiro
  assert.equal(a.eventos().filter((e) => e === 'lembrete').length, 2)
})

test('lembrete não sai para quem pediu para parar, para quem está com atendente nem depois de 24h', async () => {
  const parou = ambiente()
  await parou.sequencia(parou.texto('oi'), parou.texto('parar'))
  parou.limpar(); parou.avancar(40); await parou.app.tique()
  assert.equal(parou.enviados.length, 0)

  const humano = ambiente()
  await humano.sequencia(humano.texto('oi'), humano.texto('atendente'))
  humano.limpar(); humano.avancar(40); await humano.app.tique()
  assert.equal(humano.enviados.length, 0)

  const tarde = ambiente({ opcoes: { lembretesMin: [30, 20 * 60], horaInicio: 0, horaFim: 24 } })
  await tarde.mandar(tarde.texto('oi'))
  tarde.limpar(); tarde.avancar(24 * 60 + 5); await tarde.app.tique()
  assert.equal(tarde.enviados.length, 0) // janela de 24h fechada: o WhatsApp recusaria
})

test('depois do PDF: um único lembrete com opção de parar; "agora não" cancela o lembrete', async () => {
  const a = ambiente({ opcoes: { horaInicio: 0, horaFim: 24 } })
  await a.ateConfirmar(); await a.mandar(a.clique('confirmar:gerar'))
  a.limpar(); a.avancar(20 * 60 + 1); await a.app.tique()
  assert.match(a.enviados[0].texto, /Ficou alguma dúvida/)
  assert.deepEqual(a.enviados[0].ids, ['acao:consultor', 'acao:parar'])
  a.avancar(60); await a.app.tique()
  assert.equal(a.enviados.length, 1)

  const b = ambiente({ opcoes: { horaInicio: 0, horaFim: 24 } })
  await b.ateConfirmar(); await b.sequencia(b.clique('confirmar:gerar'), b.clique('pos:depois'))
  b.limpar(); b.avancar(20 * 60 + 1); await b.app.tique()
  assert.equal(b.enviados.length, 0)
})

test('retomada: quem volta horas depois continua de onde parou', async () => {
  const a = ambiente()
  await a.sequencia(a.texto('oi'), a.clique('cidade:cidade-exemplo-a'), a.clique('imovel:casa'))
  a.limpar(); a.avancar(7 * 60)
  await a.mandar(a.texto('oi, voltei'))
  assert.match(a.enviados[0].texto, /de onde paramos/)
  assert.deepEqual(a.enviados[1].ids.slice(0, 2), ['conta:ate150', 'conta:150a300'])
  assert.equal(a.conversa().estado.dados.imovel, 'casa')
  await a.mandar(a.clique('conta:300a500'))
  assert.equal(a.conversa().estado.etapa, 'telhado')
})

test('falha no envio do PDF: avisa o cliente, chama a equipe e pausa o bot', async () => {
  const a = ambiente()
  await a.ateConfirmar()
  a.falhar.documento = 1
  a.limpar()
  await a.mandar(a.clique('confirmar:gerar'))
  assert.match(a.enviados.at(-1).texto, /problema para gerar seu PDF/)
  assert.ok(!a.enviados.some((e) => e.tipo === 'opcoes')) // não oferece "próximo passo" de um PDF que não chegou
  assert.equal(a.conversa().estado.status, 'humano')
  assert.match(a.avisos[0], /FALHA/)
  assert.deepEqual(a.eventos().slice(-3), ['proposta_gerada', 'proposta_falha', 'handoff'])
  assert.equal(readdirSync(a.dir).length, 1) // o PDF ficou guardado para envio manual
})

test('falha na geração do PDF tem o mesmo tratamento', async () => {
  const a = ambiente({ gerarPdf: async () => { throw new Error('disco cheio') } })
  await a.ateConfirmar()
  await a.mandar(a.clique('confirmar:gerar'))
  assert.equal(a.conversa().estado.status, 'humano')
  assert.ok(!a.enviados.some((e) => e.tipo === 'documento'))
  assert.ok(a.eventos().includes('proposta_falha'))
})

test('falha ao enviar uma pergunta: o estado não se perde e o lembrete refaz a pergunta', async () => {
  const a = ambiente()
  await a.mandar(a.texto('oi'))
  a.falhar.opcoes = 1
  a.limpar()
  await a.mandar(a.clique('cidade:cidade-exemplo-a'))
  assert.equal(a.enviados.length, 0)
  assert.equal(a.conversa().estado.etapa, 'imovel')
  assert.ok(a.eventos().includes('falha_envio'))
  a.avancar(31); await a.app.tique()
  assert.deepEqual(a.enviados.at(-1).ids, ['imovel:casa', 'imovel:comercio', 'imovel:apto'])
})

test('encaminhamento humano pausa o bot; resposta do vendedor pelo app também', async () => {
  const a = ambiente()
  await a.ateConfirmar(); await a.sequencia(a.clique('confirmar:gerar'), a.clique('acao:consultor'))
  assert.match(a.enviados.at(-1).texto, /neste mesmo número/)
  assert.match(a.avisos[0], /consultor/)
  assert.doesNotMatch(a.avisos[0], /Joe|5511999990001/) // o aviso não leva nome nem telefone completo
  a.limpar()
  await a.sequencia(a.texto('vocês parcelam?'), a.clique('acao:visita'))
  assert.equal(a.enviados.length, 0)

  const b = ambiente()
  await b.mandar(b.texto('oi'))
  await b.mandar({ id: 'evt_eco', type: 'whatsapp.smb.message.echoes', whatsappMessage: { from: NUM, to: TEL, type: 'text', text: { body: 'Oi, aqui é o Carlos' } } })
  assert.equal(b.conversa().estado.status, 'humano')
  b.limpar()
  await b.mandar(b.clique('cidade:cidade-exemplo-a'))
  assert.equal(b.enviados.length, 0)
  assert.equal(b.eventos().at(-1), 'handoff')
})

test('atendimento humano expira: depois de 7 dias sem atividade um novo contato volta ao bot', async () => {
  const a = ambiente()
  await a.sequencia(a.texto('oi'), a.texto('atendente'))
  a.limpar(); a.avancar(8 * 24 * 60)
  await a.mandar(a.texto('oi de novo'))
  assert.equal(a.conversa().estado.status, 'bot')
  assert.match(a.enviados[0].texto, /assistente virtual/)
})

test('recibos de entrega: enviado, entregue e lido são eventos distintos e fora de ordem não regridem', async () => {
  const a = ambiente()
  await a.ateConfirmar(); await a.mandar(a.clique('confirmar:gerar'))
  const status = (s, id) => ({ id, type: 'whatsapp.message.updated', whatsappMessage: { status: s, externalId: 'proposta:1' } })
  await a.mandar(status('read', 's1'))
  await a.mandar(status('delivered', 's2')) // chegou atrasado
  await a.mandar(status('sent', 's3'))
  assert.equal(a.db.proposta(1).entrega, 'read')
  assert.deepEqual(a.eventos().slice(-2), ['proposta_entregue', 'proposta_mensagem_lida'])
  await a.mandar(status('failed', 's4'))
  assert.equal(a.db.proposta(1).entrega, 'failed')
  assert.match(a.avisos.at(-1), /NÃO foi entregue/)
})

test('BLOQUEIO: com tabela fictícia, quem não é número de teste não recebe nada e nada é guardado', async () => {
  const a = ambiente()
  assert.equal(a.app.real, false)
  await a.mandar(a.texto('oi', { tel: '+5511977776666', referral: ANUNCIO }))
  assert.equal(a.enviados.length, 0)
  assert.equal(a.conversa('+5511977776666'), undefined)
})

test('PDF de teste leva marca d\'água; com parâmetros aprovados, não', async () => {
  const docs = []
  const capturar = async (d) => { docs.push(d) }
  const ficticio = ambiente({ gerarPdf: capturar })
  await ficticio.ateConfirmar(); await ficticio.mandar(ficticio.clique('confirmar:gerar'))
  assert.match(docs[0].marca_dagua, /FICTÍCIOS/)
  const aprovado = ambiente({ cfg: cfgAprovado, gerarPdf: capturar, opcoes: { numerosTeste: [] } })
  await aprovado.ateConfirmar({ referral: ANUNCIO }); await aprovado.mandar(aprovado.clique('confirmar:gerar'))
  assert.equal(docs[1].marca_dagua, null)
  assert.equal(aprovado.app.real, true)
})

test('custo zero: sem anúncio o bot não responde e passa para a equipe; com anúncio responde por 72h', async () => {
  const a = ambiente({ cfg: cfgAprovado, opcoes: { numerosTeste: [] } })
  await a.mandar(a.texto('oi'))
  assert.equal(a.enviados.length, 0)
  assert.equal(a.conversa().estado.status, 'humano')
  assert.match(a.avisos[0], /sem_anuncio/)
  assert.deepEqual(a.eventos(), ['handoff'])

  await a.mandar(a.texto('Olá! Quero uma estimativa', { referral: ANUNCIO })) // clicou no anúncio: volta ao bot
  assert.match(a.enviados[0].texto, /assistente virtual/)
  assert.equal(a.conversa().origem.id, 'AD-123')
  assert.deepEqual(a.db.eventos().find((e) => e.tipo === 'conversa_iniciada').dados, { anuncio: 'AD-123', origem: 'ad' })

  a.limpar(); a.avancar(73 * 60)
  await a.mandar(a.clique('cidade:cidade-exemplo-a')) // janela gratuita acabou
  assert.equal(a.enviados.length, 0)
  assert.equal(a.conversa().estado.status, 'humano')
})

test('com BOT_SEM_ANUNCIO ligado o bot responde a qualquer contato (pago pela tarifa da Meta)', async () => {
  const a = ambiente({ cfg: cfgAprovado, opcoes: { numerosTeste: [], botSemAnuncio: true } })
  await a.mandar(a.texto('oi'))
  assert.equal(a.enviados.length, 2)
  assert.equal(a.db.eventos()[0].dados.anuncio, null) // sem dado da Meta, a origem fica vazia
})

test('pausa geral: mensagens ficam para a equipe; ao retomar, novo clique no anúncio volta ao bot', async () => {
  const a = ambiente({ cfg: cfgAprovado, opcoes: { numerosTeste: [] } })
  a.db.definirAjuste('pausado', 1)
  await a.mandar(a.texto('oi', { referral: ANUNCIO }))
  assert.equal(a.enviados.length, 0)
  assert.equal(a.conversa().estado.auto, 'bot_pausado')
  a.db.definirAjuste('pausado', 0)
  await a.mandar(a.texto('oi', { referral: ANUNCIO }))
  assert.equal(a.enviados.length, 2)
})

test('concorrência: mensagens simultâneas do mesmo cliente são processadas em ordem', async () => {
  const a = ambiente()
  await Promise.all([a.mandar(a.texto('oi')), a.mandar(a.clique('cidade:cidade-exemplo-a')), a.mandar(a.clique('imovel:casa'))])
  assert.equal(a.conversa().estado.etapa, 'conta')
  assert.deepEqual(a.enviados.map((e) => e.tipo), ['texto', 'opcoes', 'opcoes', 'opcoes'])
})

test('recuperação: evento gravado mas não processado (queda do servidor) é retomado', async () => {
  const a = ambiente()
  const ev = a.texto('oi')
  a.db.guardarRecebido(ev.id, JSON.stringify(ev), Date.UTC(2026, 9, 5, 15, 0)) // como se o processo tivesse caído logo após gravar
  assert.equal(a.db.contarPendentes(), 1)
  a.avancar(2); await a.app.tique()
  assert.equal(a.db.contarPendentes(), 0)
  assert.match(a.enviados[0].texto, /assistente virtual/)
  assert.equal(a.db.todos("SELECT corpo FROM recebidos")[0].corpo, '') // corpo com dados pessoais é apagado após processar
})

test('retenção: conversas e PDFs antigos são apagados; eventos anônimos ficam para as métricas', async () => {
  const a = ambiente()
  await a.ateConfirmar(); await a.mandar(a.clique('confirmar:gerar'))
  const arquivo = a.db.proposta(1).arquivo
  assert.ok(existsSync(arquivo))
  a.avancar(181 * 24 * 60); await a.app.tique()
  assert.equal(a.conversa(), undefined)
  assert.equal(a.db.proposta(1), undefined)
  assert.equal(existsSync(arquivo), false)
  assert.ok(a.eventos().includes('proposta_enviada'))
  assert.ok(!JSON.stringify(a.db.eventos()).includes('5511999990001'))
  assert.ok(!JSON.stringify(a.db.eventos()).includes('Joe'))
})

test('relatório do funil: conversão por etapa, motivos e origem por anúncio', async () => {
  const a = ambiente({ cfg: cfgAprovado, opcoes: { numerosTeste: [] } })
  const o1 = { tel: '+5511900000001', referral: ANUNCIO }
  const o2 = { tel: '+5511900000002', referral: { ...ANUNCIO, source_id: 'AD-999' } }
  await a.ateConfirmar(o1)
  await a.sequencia(a.clique('confirmar:gerar', { tel: o1.tel }), a.clique('acao:consultor', { tel: o1.tel }))
  await a.sequencia(a.texto('oi', o2), a.clique('cidade:cidade-exemplo-a', { tel: o2.tel })) // abandonou depois da cidade
  a.db.evento(a.conversa('+5511900000001').id, 'venda', { valor: 16900 }, 0)
  const r = relatorio(a.db.eventos())
  const linha = (nome) => r.funil.find((f) => f.etapa === nome)
  assert.equal(linha('Conversas iniciadas').conversas, 2)
  assert.equal(linha('Informou a cidade').conversas, 2)
  assert.equal(linha('Informou o imóvel').conversas, 1)
  assert.equal(linha('Informou o imóvel').da_anterior, 50)
  assert.equal(linha('Proposta enviada').do_inicio, 50)
  assert.equal(linha('Pediu contato').conversas, 1)
  assert.equal(linha('Venda').conversas, 1)
  assert.deepEqual(r.handoff_por_motivo, { consultor: 1 })
  assert.deepEqual(r.por_anuncio['AD-123'], { conversas: 1, propostas: 1, pedidos_contato: 1, vendas: 1, valor_vendido: 16900 })
  assert.deepEqual(r.por_anuncio['AD-999'], { conversas: 1, propostas: 0, pedidos_contato: 0, vendas: 0, valor_vendido: 0 })
})

test('mensagem aceita pela API mas recusada pela Meta (caso real: conta bloqueada, erro 131031) é registrada e avisada', async () => {
  const a = ambiente()
  await a.mandar(a.texto('oi'))
  const marca = a.enviados[0].externalId
  assert.equal(marca, `conv:${a.conversa().id}`) // toda mensagem do bot leva a marca da conversa
  const recusa = (id) => ({ id, type: 'whatsapp.message.updated', whatsappMessage: { status: 'failed', externalId: marca, errorCode: '131031', errorMessage: 'Business account has been locked.' } })
  await a.mandar(recusa('f1'))
  await a.mandar(recusa('f2')) // abertura e pergunta falham juntas: um aviso só
  assert.deepEqual(a.eventos().slice(-2), ['falha_entrega', 'falha_entrega'])
  assert.deepEqual(a.db.eventos().at(-1).dados, { codigo: '131031' })
  assert.equal(a.avisos.length, 1)
  assert.match(a.avisos[0], /131031.*locked/)
  await a.mandar({ id: 'ok1', type: 'whatsapp.message.updated', whatsappMessage: { status: 'delivered', externalId: marca } })
  assert.equal(a.eventos().length, 3) // entrega normal de mensagem comum não gera evento
})
