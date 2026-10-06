// Cálculos com resultados esperados, conferidos à mão sobre a tabela FIXA de test/parametros-teste.json:
// tarifa 0,95 R$/kWh · disponibilidade 50 kWh · fator de economia 0,85 · kits de 4 a 20 painéis de 550 W (115 kWh por kWp/mês).
import test from 'node:test'
import assert from 'node:assert/strict'
import { avaliar, interpretarConta, validarParametros, usoReal, ErroParametros } from '../src/orcamento.js'
import { cfgTeste } from './apoio.js'

const { parametros: p, empresa } = cfgTeste()
const reais = (min, max = min) => ({ tipo: 'reais', min, max })
const casa = (conta, telhado = 'ceramica') => ({ imovel: 'casa', telhado, conta })

test('faixa R$ 300–500: kits de 6 a 8 painéis, investimento em faixa', () => {
  const r = avaliar(casa(reais(300, 500)), p)
  assert.equal(r.tipo, 'estimativa')
  assert.deepEqual(r.consumo_kwh, [316, 526]) // 300/0,95 e 500/0,95
  assert.deepEqual(r.paineis, [6, 8]) // alvo 266 kWh -> 3,3 kWp (379 kWh); alvo 476 -> 4,4 kWp (506 kWh)
  assert.deepEqual(r.kwp, [3.3, 4.4])
  assert.deepEqual(r.geracao_kwh, [380, 506])
  assert.deepEqual(r.investimento, [13500, 16900])
  assert.deepEqual(r.economia_mensal, [215, 385]) // alvo × 0,95 × 0,85
  assert.deepEqual(r.retorno_anos, [3.7, 5.2])
  assert.equal(r.kits.length, 2)
})

test('valor exato R$ 450: um único kit, sem faixa', () => {
  const r = avaliar(casa(reais(450)), p)
  assert.deepEqual(r.paineis, [8, 8])
  assert.deepEqual(r.investimento, [16900, 16900])
  assert.equal(r.kits.length, 1)
})

test('consumo em kWh não passa pela tarifa para dimensionar', () => {
  const r = avaliar(casa({ tipo: 'kwh', min: 380, max: 380 }), p)
  assert.deepEqual(r.consumo_kwh, [380, 380])
  assert.deepEqual(r.paineis, [6, 6]) // alvo 330 kWh -> 3,3 kWp gera 379,5
})

test('faixa R$ 800–1.200 ainda cabe nos kits (16 a 20 painéis)', () => {
  const r = avaliar(casa(reais(800, 1200)), p)
  assert.deepEqual(r.paineis, [16, 20])
  assert.deepEqual(r.investimento, [29900, 36500])
})

test('registra versão, data e premissas dos parâmetros usados', () => {
  const r = avaliar(casa(reais(300, 500)), p)
  assert.equal(r.versao_parametros, p.meta.versao)
  assert.equal(r.data_parametros, p.meta.data)
  assert.equal(r.premissas.tarifa_reais_por_kwh, 0.95)
  assert.equal(r.ficticio, true)
})

test('casos que vão para análise humana', () => {
  const motivo = (d) => avaliar(d, p).motivo
  assert.equal(motivo(casa(reais(0, 150))), 'conta_baixa')
  assert.equal(motivo(casa(reais(120))), 'conta_baixa')
  assert.equal(motivo(casa({ tipo: 'reais', min: 1200, max: null })), 'acima_do_limite') // faixa aberta
  assert.equal(motivo(casa(reais(1300))), 'acima_do_limite') // precisaria de mais de 20 painéis
  assert.equal(motivo(casa({ tipo: 'desconhecida' })), 'conta_desconhecida')
  assert.equal(motivo(casa(undefined)), 'conta_desconhecida')
  assert.equal(motivo(casa(reais(NaN))), 'conta_desconhecida')
  assert.equal(motivo(casa(reais(300, 500), 'fibrocimento')), 'telhado_atipico')
  assert.equal(motivo(casa(reais(300, 500), 'laje')), 'telhado_atipico')
})

test('acima de 20 painéis é sempre "valor a consultar", mesmo que exista kit maior na tabela', () => {
  const comKitGrande = { ...p, kits: [...p.kits, { id: 'K30', paineis: 30, geracao_kwh_mes: 1900, preco_reais: 50000 }] }
  assert.equal(avaliar(casa(reais(1500)), comKitGrande).motivo, 'acima_do_limite')
})

test('apartamento/condomínio recebe estimativa, com ressalva', () => {
  const r = avaliar({ imovel: 'apto', telhado: 'na', conta: reais(300, 500) }, p)
  assert.equal(r.tipo, 'estimativa')
  assert.match(r.ressalvas[0], /condomínio/)
})

test('telhado "não sei" não bloqueia a estimativa', () => {
  assert.equal(avaliar(casa(reais(300, 500), 'naosei'), p).tipo, 'estimativa')
})

test('interpretarConta separa reais de kWh e ignora valores implausíveis', () => {
  assert.deepEqual(interpretarConta('uns 450 reais'), { tipo: 'reais', min: 450, max: 450, rotulo: 'R$ 450' })
  assert.equal(interpretarConta('R$ 1.200,50').min, 1200.5)
  assert.deepEqual([interpretarConta('entre 300 e 400').min, interpretarConta('entre 300 e 400').max], [300, 400])
  assert.equal(interpretarConta('380 kWh').tipo, 'kwh')
  assert.equal(interpretarConta('380 kWh').rotulo, '380 kWh por mês')
  assert.equal(interpretarConta('3'), null) // R$ 3 não é uma conta de luz
  assert.equal(interpretarConta('quanto custa?'), null)
  assert.equal(interpretarConta('100 200 300'), null)
})

test('bloqueio: tabela fictícia ou empresa provisória nunca libera uso real', () => {
  assert.equal(usoReal(p, empresa), false)
  const aprovado = { ...p, meta: { ...p.meta, ficticio: false, aprovado: true, aprovado_por: 'Responsável', aprovado_em: '2026-10-10' } }
  assert.equal(usoReal(aprovado, { ...empresa, provisorio: true }), false)
  assert.equal(usoReal(aprovado, { ...empresa, provisorio: false }), true)
  assert.equal(usoReal({ ...aprovado, meta: { ...aprovado.meta, ficticio: true } }, { ...empresa, provisorio: false }), false)
})

test('validarParametros recusa tabela incoerente', () => {
  assert.throws(() => validarParametros({ ...p, tarifa_reais_por_kwh: 0 }), ErroParametros)
  assert.throws(() => validarParametros({ ...p, kits: [] }), ErroParametros)
  assert.throws(() => validarParametros({ ...p, meta: { ...p.meta, aprovado: true } }), /aprovado/) // aprovado + fictício, sem responsável
  assert.throws(() => validarParametros({ ...p, fator_economia: 1.2 }), ErroParametros)
  assert.doesNotThrow(() => validarParametros(p))
})

test('kit sem potência de módulo: estimativa sai sem kWp, só com painéis e geração', () => {
  const semPotencia = { ...p, kits: p.kits.map(({ potencia_modulo_w, ...k }) => k) }
  const r = avaliar(casa(reais(300, 500)), semPotencia)
  assert.equal(r.kwp, null)
  assert.deepEqual(r.paineis, [6, 8])
  assert.deepEqual(r.geracao_kwh, [380, 506])
})

test('economia e retorno podem ser desligados na tabela', () => {
  const r = avaliar(casa(reais(300, 500)), { ...p, mostrar_economia: false })
  assert.equal(r.economia_mensal, null)
  assert.equal(r.retorno_anos, null)
  assert.deepEqual(r.investimento, [13500, 16900]) // o resto não muda
})
