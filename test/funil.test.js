import test from 'node:test'
import assert from 'node:assert/strict'
import { passo, pergunta, nomeLimpo, ETAPAS } from '../src/funil.js'
import { cfgTeste } from './apoio.js'

const cfg = cfgTeste()
const clicar = (id) => ({ tipo: 'opcao', id })
const digitar = (texto) => ({ tipo: 'texto', texto })
const midia = (m) => ({ tipo: 'midia', midia: m })

/** Roda uma sequência de entradas e devolve o estado final, as ações do último passo e todas as ações. */
function conversar(entradas, extra = {}, inicio) {
  let conv = inicio
  let ultimo
  const todas = []
  for (const e of entradas) {
    ultimo = passo(conv, e, { ...cfg, nomePerfil: 'Joe Silva', ...extra })
    conv = ultimo.conv
    todas.push(...ultimo.acoes)
  }
  return { conv, acoes: ultimo.acoes, todas }
}
const tipos = (acoes) => acoes.map((a) => a.tipo)
const eventos = (acoes) => acoes.filter((a) => a.tipo === 'evento').map((a) => a.nome)
const textoDe = (acoes) => acoes.filter((a) => a.texto).map((a) => a.texto).join('\n')
const ATE_CONFIRMAR = [digitar('oi'), clicar('cidade:cidade-exemplo-a'), clicar('imovel:casa'), clicar('conta:300a500'), clicar('telhado:ceramica')]

test('jornada completa por cliques chega à proposta', () => {
  const { conv, acoes, todas } = conversar([...ATE_CONFIRMAR, clicar('confirmar:gerar')])
  assert.equal(conv.etapa, 'pos')
  assert.equal(conv.status, 'bot')
  const proposta = acoes.find((a) => a.tipo === 'proposta')
  assert.deepEqual(proposta.orcamento.investimento, [13500, 16900])
  assert.deepEqual(tipos(acoes), ['evento', 'texto', 'proposta', 'opcoes']) // qualificado, "gerando", PDF, próximo passo
  assert.deepEqual(eventos(todas), [
    'conversa_iniciada', 'etapa_concluida', 'etapa_concluida', 'etapa_concluida', 'etapa_concluida', 'qualificado',
  ])
  assert.deepEqual(conv.dados, {
    nome: 'Joe Silva', cidade: 'Cidade Exemplo A', imovel: 'casa',
    conta: { tipo: 'reais', min: 300, max: 500, rotulo: 'R$ 300 a R$ 500' }, telhado: 'ceramica',
  })
})

test('abertura identifica a empresa, o atendimento automatizado e a saída', () => {
  const { acoes } = conversar([digitar('Olá! Quero uma estimativa')])
  assert.match(acoes[1].texto, /assistente virtual da \*Renovo\*/)
  assert.match(acoes[1].texto, /Joe/)
  assert.match(acoes[1].texto, /atendente/)
  assert.match(acoes[1].texto, /parar/)
  assert.equal(acoes[2].tipo, 'opcoes') // já vem a primeira pergunta
})

test('jornada digitando em vez de clicar', () => {
  const { conv, acoes } = conversar([
    digitar('oi'), digitar('cidade exemplo b'), digitar('moro numa casa'), digitar('uns 450'), digitar('telha de barro'), digitar('Gerar estimativa'),
  ])
  assert.equal(conv.dados.cidade, 'Cidade Exemplo B')
  assert.equal(conv.dados.conta.min, 450)
  assert.equal(conv.dados.telhado, 'ceramica')
  assert.ok(acoes.some((a) => a.tipo === 'proposta'))
})

test('lead fora da área atendida não recebe proposta', () => {
  const r = conversar([digitar('oi'), clicar('cidade:outra'), digitar('João Pessoa')])
  assert.equal(r.conv.etapa, 'fora')
  assert.equal(r.conv.status, 'bot') // "Pessoa" não é pedido de atendente
  assert.deepEqual(eventos(r.acoes), ['fora_area'])
  assert.match(textoDe(r.acoes), /não atende \*João Pessoa\*/)
  const fim = conversar([digitar('sim, me avisem')], {}, r.conv)
  assert.equal(fim.conv.etapa, 'fim')
  assert.deepEqual(eventos(fim.acoes), ['fora_area_interesse'])
  assert.ok(!r.todas.concat(fim.todas).some((a) => a.tipo === 'proposta'))
})

test('cidade atendida digitada depois de "Outra cidade" segue o fluxo', () => {
  const { conv } = conversar([digitar('oi'), clicar('cidade:outra'), digitar('Cidade Exemplo C')])
  assert.equal(conv.etapa, 'imovel')
})

test('sem nome de perfil, pergunta o nome e valida', () => {
  const semNome = { nomePerfil: '🔥🔥' }
  const r = conversar(ATE_CONFIRMAR, semNome)
  assert.equal(r.conv.etapa, 'nome')
  const ruim = conversar([digitar('12345')], semNome, r.conv)
  assert.equal(ruim.conv.etapa, 'nome')
  assert.match(textoDe(ruim.acoes), /Não consegui ler o nome/)
  const bom = conversar([digitar('meu nome é Ana Souza')], semNome, r.conv)
  assert.equal(bom.conv.dados.nome, 'Ana Souza')
  assert.equal(bom.conv.etapa, 'confirmar')
})

test('resposta desconhecida: orienta na primeira, chama uma pessoa na segunda', () => {
  const r1 = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), digitar('xyz qualquer coisa')])
  assert.equal(r1.conv.etapa, 'imovel')
  assert.equal(r1.conv.falhas, 1)
  assert.match(r1.acoes.find((a) => a.tipo === 'texto').texto, /Não entendi/)
  assert.equal(r1.acoes.at(-1).tipo, 'opcoes') // repete a pergunta com as opções
  const r2 = conversar([digitar('??')], {}, r1.conv)
  assert.equal(r2.conv.status, 'humano')
  assert.equal(r2.acoes.find((a) => a.tipo === 'humano').motivo, 'nao_entendeu')
})

test('acerto zera a contagem de falhas', () => {
  const r = conversar([digitar('oi'), digitar('hã?'), clicar('cidade:cidade-exemplo-a'), digitar('hã?')])
  assert.equal(r.conv.status, 'bot')
  assert.equal(r.conv.falhas, 1)
})

test('áudio recebe orientação; foto na etapa da conta vai para uma pessoa', () => {
  const audio = conversar([digitar('oi'), midia('audio')])
  assert.match(textoDe(audio.acoes), /não consigo ouvir áudios/)
  assert.equal(audio.conv.etapa, 'cidade')
  const foto = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), clicar('imovel:casa'), midia('image')])
  assert.equal(foto.conv.status, 'humano')
  assert.equal(foto.acoes.find((a) => a.tipo === 'humano').motivo, 'conta_enviada')
})

test('clique atrasado em botão de pergunta anterior não altera o estado', () => {
  const antes = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), clicar('imovel:casa')])
  const r = conversar([clicar('imovel:comercio')], {}, antes.conv)
  assert.equal(r.conv.etapa, 'conta')
  assert.equal(r.conv.dados.imovel, 'casa')
  assert.equal(r.conv.falhas, 0)
  assert.match(textoDe(r.acoes), /pergunta anterior/)
  assert.deepEqual(eventos(r.acoes), ['clique_antigo'])
})

test('segundo clique em "Gerar estimativa" depois do PDF não gera outra proposta', () => {
  const pos = conversar([...ATE_CONFIRMAR, clicar('confirmar:gerar')])
  const r = conversar([clicar('confirmar:gerar')], {}, pos.conv)
  assert.ok(!r.acoes.some((a) => a.tipo === 'proposta'))
  assert.equal(r.conv.etapa, 'pos')
})

test('correção de uma resposta volta direto para a confirmação', () => {
  const r = conversar([...ATE_CONFIRMAR, clicar('confirmar:corrigir'), clicar('corrigir:conta'), clicar('conta:500a800')])
  assert.equal(r.conv.etapa, 'confirmar')
  assert.equal(r.conv.dados.conta.rotulo, 'R$ 500 a R$ 800')
  assert.match(r.acoes.at(-1).texto, /R\$ 500 a R\$ 800/)
  assert.equal(r.conv.dados.cidade, 'Cidade Exemplo A') // o resto foi preservado
})

test('"voltar" digitado abre a correção; trocar casa por apto dispensa o telhado', () => {
  const r = conversar([...ATE_CONFIRMAR, digitar('voltar'), clicar('corrigir:imovel'), clicar('imovel:apto')])
  assert.equal(r.conv.etapa, 'confirmar')
  assert.equal(r.conv.dados.telhado, 'na')
  assert.doesNotMatch(r.acoes.at(-1).texto, /Telhado/)
  const volta = conversar([clicar('confirmar:corrigir'), clicar('corrigir:imovel'), clicar('imovel:casa')], {}, r.conv)
  assert.equal(volta.conv.etapa, 'telhado') // voltou a ter telhado: pergunta de novo
})

test('apartamento pula a pergunta do telhado', () => {
  const r = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), clicar('imovel:apto'), clicar('conta:300a500')])
  assert.equal(r.conv.etapa, 'confirmar')
})

test('pedir atendente em qualquer etapa pausa o bot', () => {
  const r = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), digitar('quero falar com um atendente')])
  assert.equal(r.conv.status, 'humano')
  assert.equal(r.acoes.find((a) => a.tipo === 'humano').motivo, 'consultor')
  assert.match(textoDe(r.acoes), /neste mesmo número/)
  const primeira = conversar([digitar('atendente')])
  assert.equal(primeira.conv.status, 'humano')
  assert.deepEqual(eventos(primeira.acoes), ['conversa_iniciada', 'handoff'])
})

test('"parar" encerra e marca opt-out; "recomeçar" zera as respostas', () => {
  const parar = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), digitar('PARAR')])
  assert.equal(parar.conv.optout, true)
  assert.equal(parar.conv.etapa, 'fim')
  const rec = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), digitar('recomeçar')])
  assert.equal(rec.conv.etapa, 'cidade')
  assert.equal(rec.conv.dados.cidade, undefined)
})

test('casos de análise humana não geram proposta e explicam o motivo', () => {
  const caso = (conta, telhado = 'telhado:ceramica') =>
    conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a'), clicar('imovel:casa'), clicar(conta), clicar(telhado), clicar('confirmar:gerar')])
  for (const [r, motivo] of [
    [caso('conta:ate150'), 'conta_baixa'],
    [caso('conta:acima1200'), 'acima_do_limite'],
    [caso('conta:naosei'), 'conta_desconhecida'],
    [caso('conta:300a500', 'telhado:fibrocimento'), 'telhado_atipico'],
  ]) {
    assert.equal(r.conv.status, 'humano')
    assert.equal(r.acoes.find((a) => a.tipo === 'humano').motivo, motivo)
    assert.ok(!r.acoes.some((a) => a.tipo === 'proposta'))
    assert.match(textoDe(r.acoes), /especialista/)
  }
})

test('depois do PDF: consultor, visita, "agora não" e dúvida digitada', () => {
  const pos = conversar([...ATE_CONFIRMAR, clicar('confirmar:gerar')]).conv
  assert.equal(conversar([clicar('acao:consultor')], {}, pos).acoes.find((a) => a.tipo === 'humano').motivo, 'consultor')
  assert.equal(conversar([clicar('acao:visita')], {}, pos).acoes.find((a) => a.tipo === 'humano').motivo, 'visita')
  const depois = conversar([clicar('pos:depois')], {}, pos)
  assert.equal(depois.conv.status, 'bot')
  assert.equal(depois.conv.sem_lembrete, true)
  assert.equal(conversar([digitar('vocês parcelam?')], {}, pos).acoes.find((a) => a.tipo === 'humano').motivo, 'duvida')
})

test('retomada depois de um tempo não conta como erro nem obriga a recomeçar', () => {
  const meio = conversar([digitar('oi'), clicar('cidade:cidade-exemplo-a')]).conv
  const r = conversar([digitar('oi, voltei')], { retorno: true }, meio)
  assert.equal(r.conv.etapa, 'imovel')
  assert.equal(r.conv.falhas, 0)
  assert.match(textoDe(r.acoes), /de onde paramos/)
  assert.equal(conversar([clicar('imovel:casa')], { retorno: true }, meio).conv.etapa, 'conta') // resposta válida segue direto
})

test('nova mensagem depois de encerrada começa uma conversa nova', () => {
  const fim = conversar([digitar('oi'), digitar('parar')]).conv
  const r = conversar([digitar('oi')], {}, fim)
  assert.equal(r.conv.etapa, 'cidade')
  assert.deepEqual(eventos(r.acoes), ['conversa_iniciada'])
})

test('com mais de 9 cidades, a lista mostra as 9 primeiras e as demais valem digitando', () => {
  const nomes = ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Teta', 'Iota', 'Capa', 'Lambda', 'Mi']
  const empresa = { ...cfg.empresa, cidades_atendidas: nomes }
  const r = conversar([digitar('oi')], { empresa })
  const lista = r.acoes.at(-1)
  assert.equal(lista.opcoes.length, 10) // limite da lista do WhatsApp
  assert.deepEqual(lista.opcoes.map((o) => o.titulo), [...nomes.slice(0, 9), 'Outra cidade'])
  assert.equal(conversar([digitar('lambda')], { empresa }, r.conv).conv.dados.cidade, 'Lambda') // fora da lista visível, mas atendida
  const outra = conversar([clicar('cidade:outra'), digitar('Mi')], { empresa }, r.conv)
  assert.equal(outra.conv.dados.cidade, 'Mi')
  assert.equal(conversar([clicar('cidade:outra'), digitar('Outro Lugar')], { empresa }, r.conv).conv.etapa, 'fora')
})

test('todas as perguntas respeitam os limites dos componentes do WhatsApp', () => {
  const dados = { cidade: 'Cidade Exemplo A', imovel: 'casa', conta: { rotulo: 'R$ 300 a R$ 500' }, telhado: 'ceramica', nome: 'Joe', cidade_fora: 'X' }
  for (const etapa of [...ETAPAS, 'confirmar', 'corrigir', 'pos', 'fora']) {
    for (const a of pergunta({ etapa, dados }, cfg)) {
      if (a.tipo !== 'opcoes') continue
      const botoes = a.opcoes.length <= 3
      assert.ok(a.opcoes.length <= 10, `${etapa}: mais de 10 opções`)
      assert.ok(a.texto.length <= (botoes ? 1024 : 4096), `${etapa}: texto longo`)
      if (!botoes) assert.ok(a.botao && a.botao.length <= 20, `${etapa}: botão da lista ausente ou longo`)
      for (const o of a.opcoes) assert.ok(o.titulo.length <= (botoes ? 20 : 24), `${etapa}: título longo "${o.titulo}"`)
    }
  }
})

test('nomeLimpo remove emojis e recusa o que não é nome', () => {
  assert.equal(nomeLimpo('Ana ☀️ Souza'), 'Ana Souza')
  assert.equal(nomeLimpo('🔥'), null)
  assert.equal(nomeLimpo(undefined), null)
})
