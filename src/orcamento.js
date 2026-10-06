// Motor de orçamento. Só regras explícitas sobre config/parametros.json — sem I/O e sem texto livre de modelo.
// Regras documentadas em docs/REGRAS-CALCULO.md.

export const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
export const num = (v, casas = 0) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v)
export const faixa = (a, b, fmt = num) => (a === b ? fmt(a) : `${fmt(a)} a ${fmt(b)}`)

export class ErroParametros extends Error {}

const positivo = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Falha cedo (na subida do servidor e nos testes) se a tabela estiver incoerente. */
export function validarParametros(p) {
  const erros = []
  const m = p.meta ?? {}
  for (const c of ['versao', 'data', 'origem']) if (!m[c]) erros.push(`meta.${c} ausente`)
  if (m.aprovado === true) {
    if (m.ficticio === true) erros.push('meta.aprovado e meta.ficticio não podem ser true ao mesmo tempo')
    if (!m.aprovado_por || !m.aprovado_em) erros.push('meta.aprovado exige aprovado_por e aprovado_em')
  }
  for (const c of ['tarifa_reais_por_kwh', 'conta_minima_reais', 'max_paineis_automatico'])
    if (!positivo(p[c])) erros.push(`${c} deve ser número > 0`)
  if (!(p.custo_disponibilidade_kwh >= 0)) erros.push('custo_disponibilidade_kwh deve ser >= 0')
  if (!(p.fator_economia > 0 && p.fator_economia <= 1)) erros.push('fator_economia deve estar entre 0 e 1')
  if (p.projecao && !(p.projecao.anos > 0 && p.projecao.reajuste_tarifa_anual >= 0 && p.projecao.degradacao_anual >= 0))
    erros.push('projecao exige anos > 0, reajuste_tarifa_anual >= 0 e degradacao_anual >= 0')
  if (!Array.isArray(p.kits) || p.kits.length === 0) erros.push('kits vazio')
  for (const k of p.kits ?? []) {
    if (!k.id || !positivo(k.paineis) || !positivo(k.geracao_kwh_mes) || !positivo(k.preco_reais))
      erros.push(`kit ${k.id ?? '?'} incompleto (id, paineis, geracao_kwh_mes, preco_reais)`)
  }
  for (const lista of ['faixas_conta', 'imoveis', 'telhados']) {
    const ids = (p[lista] ?? []).map((x) => x.id)
    if (ids.length === 0) erros.push(`${lista} vazio`)
    if (new Set(ids).size !== ids.length) erros.push(`${lista} tem ids repetidos`)
  }
  if (erros.length) throw new ErroParametros('parametros.json inválido:\n- ' + erros.join('\n- '))
  return p
}

/** Proposta real só com tabela aprovada pelo responsável E dados da empresa definitivos. */
export const usoReal = (parametros, empresa) =>
  parametros.meta.aprovado === true && parametros.meta.ficticio !== true && empresa.provisorio !== true

const LIMITE_PLAUSIVEL = [30, 100000]

/** "450", "R$ 1.200,50", "uns 300 a 400", "380 kWh" -> { tipo, min, max, rotulo } ou null. */
export function interpretarConta(texto) {
  const t = String(texto).toLowerCase()
  const valores = [...t.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g)]
    .map((m) => Number(m[1].replaceAll('.', '') + '.' + (m[2] ?? '0')))
    .filter((v) => v >= LIMITE_PLAUSIVEL[0] && v <= LIMITE_PLAUSIVEL[1])
  if (valores.length === 0 || valores.length > 2) return null
  const [min, max] = [Math.min(...valores), Math.max(...valores)]
  const kwh = /kwh|kw\/h|quilowatt/.test(t)
  return {
    tipo: kwh ? 'kwh' : 'reais',
    min,
    max,
    rotulo: kwh ? `${faixa(min, max)} kWh por mês` : faixa(min, max, brl),
  }
}

// Potência só aparece se a empresa informar a potência do módulo; a geração vem sempre da tabela de kits.
const kwpDoKit = (k) => (k.potencia_modulo_w ? (k.paineis * k.potencia_modulo_w) / 1000 : null)

/**
 * dados: { imovel, telhado, conta: { tipo: 'reais'|'kwh'|'desconhecida', min, max } }
 * Retorna { tipo: 'estimativa', ... } ou { tipo: 'analise_humana', motivo }.
 */
export function avaliar(dados, p) {
  const humano = (motivo) => ({ tipo: 'analise_humana', motivo })
  const { conta } = dados
  const telhado = p.telhados.find((t) => t.id === dados.telhado)
  const imovel = p.imoveis.find((i) => i.id === dados.imovel)

  if (!conta || conta.tipo === 'desconhecida' || !positivo(conta.max ?? 1) || conta.min == null) return humano('conta_desconhecida')
  if (telhado?.analise_humana) return humano('telhado_atipico')
  if (conta.max == null) return humano('acima_do_limite') // faixa aberta: "acima de..."

  const tarifa = p.tarifa_reais_por_kwh
  // Consumo (kWh) e gasto (R$) são grandezas separadas; só convertemos pela tarifa aprovada.
  const emKwh = (v) => (conta.tipo === 'kwh' ? v : v / tarifa)
  const emReais = (v) => (conta.tipo === 'kwh' ? v * tarifa : v)
  if (emReais(conta.max) <= p.conta_minima_reais) return humano('conta_baixa')

  const kits = p.kits
    .filter((k) => k.paineis <= p.max_paineis_automatico)
    .map((k) => ({ ...k, kwp: kwpDoKit(k), geracao_kwh: k.geracao_kwh_mes }))
    .sort((a, b) => a.geracao_kwh - b.geracao_kwh)

  const pontas = [conta.min, conta.max].map((v) => {
    const consumo = emKwh(v)
    // O custo de disponibilidade é cobrado mesmo com geração própria: não entra no dimensionamento.
    const alvo = Math.max(consumo - p.custo_disponibilidade_kwh, 0)
    const kit = kits.find((k) => k.geracao_kwh >= alvo)
    if (!kit) return null
    const economia = Math.min(kit.geracao_kwh, alvo) * tarifa * p.fator_economia
    return { consumo, kit, economia }
  })
  if (pontas.some((x) => x === null)) return humano('acima_do_limite')

  const [a, b] = pontas
  const par = (f) => [f(a), f(b)]
  const comEconomia = p.mostrar_economia !== false
  // Projeção: a cada ano a tarifa sobe (reajuste) e os painéis geram um pouco menos (degradação). O 1º ano não tem ajuste.
  const pj = comEconomia && p.projecao?.anos > 0 ? p.projecao : null
  const fatorAnual = pj ? (1 + pj.reajuste_tarifa_anual) * (1 - pj.degradacao_anual) : 1
  const somaAnos = pj ? Array.from({ length: pj.anos }, (_, k) => fatorAnual ** k).reduce((s, v) => s + v, 0) : 0
  const retorno = pontas
    .filter((x) => x.economia > 0)
    .map((x) => Math.round((x.kit.preco_reais / (x.economia * 12)) * 10) / 10)
    .sort((x, y) => x - y)

  return {
    tipo: 'estimativa',
    consumo_kwh: par((x) => Math.round(x.consumo)),
    kits: a.kit.id === b.kit.id ? [a.kit] : [a.kit, b.kit],
    paineis: par((x) => x.kit.paineis),
    kwp: pontas.every((x) => x.kit.kwp) ? par((x) => Math.round(x.kit.kwp * 100) / 100) : null,
    geracao_kwh: par((x) => Math.round(x.kit.geracao_kwh)),
    investimento: par((x) => x.kit.preco_reais),
    economia_mensal: comEconomia ? par((x) => Math.round(x.economia)) : null,
    economia_anual: comEconomia ? par((x) => Math.round(x.economia * 12)) : null,
    economia_acumulada: pj ? { ...pj, valores: par((x) => Math.round(x.economia * 12 * somaAnos)) } : null,
    retorno_anos: comEconomia && p.mostrar_retorno && retorno.length ? [retorno[0], retorno.at(-1)] : null,
    ressalvas: [imovel?.ressalva].filter(Boolean),
    premissas: {
      tarifa_reais_por_kwh: tarifa,
      custo_disponibilidade_kwh: p.custo_disponibilidade_kwh,
      fator_economia: p.fator_economia,
    },
    versao_parametros: p.meta.versao,
    data_parametros: p.meta.data,
    ficticio: p.meta.ficticio === true,
  }
}
