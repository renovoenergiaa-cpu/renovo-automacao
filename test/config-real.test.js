// Confere a configuração REAL em config/ (a que vai para produção): regras de preço informadas pelo cliente,
// limites do WhatsApp nos textos atuais e o bloqueio enquanto a tabela não for aprovada.
// Os testes de lógica usam uma tabela fixa (test/apoio.js); aqui só entram regras que valem para qualquer tarifa.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carregarConfig } from '../src/config.js'
import { avaliar, usoReal } from '../src/orcamento.js'
import { passo, pergunta, ETAPAS } from '../src/funil.js'
import { montarInterativo } from '../src/ycloud.js'
import { gerarPdf, documentoDaProposta } from '../src/pdf.js'

const cfg = carregarConfig()
const { parametros: p, empresa } = cfg
const casa = (conta) => ({ imovel: 'casa', telhado: 'ceramica', conta })

test('kits seguem a regra do cliente: 6 painéis por R$ 10.990 e R$ 1.000 por painel a mais, até 20', () => {
  const geracaoInformada = { 6: 406, 8: 541, 10: 677, 12: 812, 14: 947, 16: 1083, 18: 1218, 20: 1353 }
  assert.deepEqual(p.kits.map((k) => k.paineis), [6, 8, 10, 12, 14, 16, 18, 20])
  for (const k of p.kits) {
    assert.equal(k.preco_reais, 10990 + (k.paineis - 6) * 1000, `preço do kit de ${k.paineis}`)
    assert.equal(k.geracao_kwh_mes, geracaoInformada[k.paineis], `geração do kit de ${k.paineis}`)
  }
  assert.equal(p.max_paineis_automatico, 20)
})

test('o kit escolhido é sempre o menor que cobre o consumo; acima de 20 painéis vai para atendente', () => {
  const t = p.tarifa_reais_por_kwh
  const d = p.custo_disponibilidade_kwh
  const contaPara = (kwh) => (kwh + d) * t // conta que corresponde a um alvo de geração
  for (const [i, k] of p.kits.entries()) {
    const r = avaliar(casa({ tipo: 'reais', min: contaPara(k.geracao_kwh_mes), max: contaPara(k.geracao_kwh_mes) }), p)
    if (contaPara(k.geracao_kwh_mes) <= p.conta_minima_reais) continue
    assert.deepEqual(r.paineis, [k.paineis, k.paineis], `consumo igual à geração do kit de ${k.paineis}`)
    assert.deepEqual(r.investimento, [k.preco_reais, k.preco_reais])
    const proximo = p.kits[i + 1]
    const acima = avaliar(casa({ tipo: 'reais', min: contaPara(k.geracao_kwh_mes + 1), max: contaPara(k.geracao_kwh_mes + 1) }), p)
    if (proximo) assert.deepEqual(acima.paineis, [proximo.paineis, proximo.paineis])
    else assert.equal(acima.motivo, 'acima_do_limite')
  }
})

test('toda faixa de conta da lista leva a um resultado válido e crescente', () => {
  let anterior = 0
  for (const f of p.faixas_conta) {
    const conta = f.min == null ? { tipo: 'desconhecida' } : { tipo: 'reais', min: f.min, max: f.max }
    const r = avaliar(casa(conta), p)
    assert.ok(['estimativa', 'analise_humana'].includes(r.tipo), f.id)
    if (r.tipo !== 'estimativa') continue
    assert.ok(r.investimento[0] >= anterior, `${f.id}: investimento não pode diminuir`)
    assert.ok(r.investimento[1] >= r.investimento[0])
    anterior = r.investimento[0]
  }
  // a última faixa fechada precisa caber nos kits: senão a lista ofereceria uma opção que sempre cai no atendente
  const fechadas = p.faixas_conta.filter((f) => f.max != null && f.max > p.conta_minima_reais)
  assert.equal(avaliar(casa({ tipo: 'reais', min: fechadas.at(-1).min, max: fechadas.at(-1).max }), p).tipo, 'estimativa')
})

test('textos e opções reais respeitam os limites do WhatsApp', () => {
  const dados = { cidade: empresa.cidades_atendidas[0], imovel: p.imoveis[0].id, conta: { rotulo: p.faixas_conta[1].rotulo }, telhado: p.telhados[0].id, nome: 'Joe', cidade_fora: 'Votorantim' }
  for (const etapa of [...ETAPAS, 'confirmar', 'corrigir', 'pos', 'fora'])
    for (const a of pergunta({ etapa, dados }, cfg)) if (a.tipo === 'opcoes') assert.doesNotThrow(() => montarInterativo(a), etapa)
})

test('cidade fora da lista: enquanto a região não estiver fechada, um consultor confirma', () => {
  assert.equal(empresa.cidade_fora, 'consultar')
  let r = passo(undefined, { tipo: 'texto', texto: 'oi' }, { ...cfg, nomePerfil: 'Joe' })
  r = passo(r.conv, { tipo: 'opcao', id: 'cidade:outra' }, { ...cfg, nomePerfil: 'Joe' })
  r = passo(r.conv, { tipo: 'texto', texto: 'Indaiatuba' }, { ...cfg, nomePerfil: 'Joe' }) // 52 km: fora do raio de 45 km
  assert.equal(r.conv.status, 'humano')
  assert.equal(r.acoes.find((a) => a.tipo === 'humano').motivo, 'cidade_a_confirmar')
  assert.match(r.acoes.find((a) => a.tipo === 'texto').texto, /atendemos \*Indaiatuba\*/)
})

const digitarCidade = (texto) => {
  let r = passo(undefined, { tipo: 'texto', texto: 'oi' }, { ...cfg, nomePerfil: 'Joe' })
  r = passo(r.conv, { tipo: 'opcao', id: 'cidade:outra' }, { ...cfg, nomePerfil: 'Joe' })
  return passo(r.conv, { tipo: 'texto', texto }, { ...cfg, nomePerfil: 'Joe' }).conv
}

test('cidades do raio de 45 km são atendidas pelo bot, pela lista ou digitando', () => {
  assert.equal(empresa.cidades_atendidas.length, 21)
  assert.equal(empresa.cidades_atendidas[0], 'Sorocaba')
  for (const cidade of ['Votorantim', 'porto feliz', 'ALUMÍNIO', 'Itu', 'tatui', 'Vargem Grande Paulista', 'Pilar do Sul'])
    assert.equal(digitarCidade(cidade).etapa, 'imovel', cidade)
})

test('"Salto" e "Salto de Pirapora" não se confundem; duas cidades na mesma frase ficam para o consultor', () => {
  assert.equal(digitarCidade('Salto').dados.cidade, 'Salto')
  assert.equal(digitarCidade('salto de pirapora').dados.cidade, 'Salto de Pirapora')
  assert.equal(digitarCidade('moro em Salto de Pirapora SP').dados.cidade, 'Salto de Pirapora')
  assert.equal(digitarCidade('Itu ou Salto').status, 'humano') // ambíguo: uma pessoa confirma
})

test('reproduz o exemplo de proposta do sistema anterior enviado pelo cliente (conta de R$ 850)', () => {
  // Exemplo: consumo 894,74 kWh · geração 947 kWh · 7,7 kWp · 14 placas · economia R$ 765/mês e R$ 9.180/ano ·
  // acumulado em 25 anos R$ 467.622 · retorno simples 2,07 anos.
  const r = avaliar(casa({ tipo: 'reais', min: 850, max: 850 }), p)
  assert.deepEqual(r.consumo_kwh, [895, 895]) // 850 ÷ 0,95 = 894,74
  assert.deepEqual(r.paineis, [14, 14])
  assert.deepEqual(r.geracao_kwh, [947, 947])
  assert.deepEqual(r.kwp, [7.7, 7.7])
  assert.deepEqual(r.investimento, [18990, 18990])
  assert.deepEqual(r.economia_mensal, [765, 765])
  assert.deepEqual(r.economia_anual, [9180, 9180])
  assert.deepEqual(r.economia_acumulada.valores, [467622, 467622])
  assert.equal(r.economia_acumulada.anos, 25)
  assert.deepEqual(r.retorno_anos, [2.1, 2.1]) // 18.990 ÷ 9.180 = 2,07; o PDF mostra uma casa decimal
})

test('"Sorocaba SP" digitado é reconhecido como Sorocaba', () => {
  let r = passo(undefined, { tipo: 'texto', texto: 'oi' }, { ...cfg, nomePerfil: 'Joe' })
  r = passo(r.conv, { tipo: 'texto', texto: 'moro em Sorocaba SP' }, { ...cfg, nomePerfil: 'Joe' })
  assert.equal(r.conv.dados.cidade, 'Sorocaba')
  assert.equal(r.conv.etapa, 'imovel')
})

test('uso real continua bloqueado até a tabela ser aprovada e os dados da empresa serem definitivos', () => {
  assert.equal(usoReal(p, empresa), p.meta.aprovado === true && empresa.provisorio !== true)
  if (p.meta.pendentes?.length) assert.equal(p.meta.aprovado, false, 'há parâmetros pendentes: a tabela não pode estar aprovada')
})

test('PDF com a configuração real: logo embutido e marca d\'água de rascunho enquanto não aprovado', async () => {
  const faixa = p.faixas_conta.find((f) => f.max != null && f.max > p.conta_minima_reais)
  const dados = { nome: 'Cliente Teste', cidade: empresa.cidades_atendidas[0], imovel: 'casa', telhado: 'ceramica', conta: { tipo: 'reais', min: faixa.min, max: faixa.max, rotulo: faixa.rotulo } }
  const doc = documentoDaProposta({ numero: 1, criadaEm: Date.now(), cfg, dados, orcamento: avaliar(dados, p), real: usoReal(p, empresa) })
  if (!usoReal(p, empresa)) assert.match(doc.marca_dagua, p.meta.ficticio ? /FICTÍCIOS/ : /RASCUNHO/)
  const destino = join(mkdtempSync(join(tmpdir(), 'pdf-real-')), 'x.pdf')
  await gerarPdf(doc, destino)
  assert.ok(statSync(destino).size > (empresa.logo ? 20_000 : 4_000)) // com logo o arquivo fica bem maior
})
