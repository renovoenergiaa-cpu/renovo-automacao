// Carrega e valida config/*.json. Falha na subida se algo estiver incoerente.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validarParametros } from './orcamento.js'

const ler = (nome) => JSON.parse(readFileSync(new URL(`../config/${nome}.json`, import.meta.url), 'utf8'))

export function carregarConfig() {
  const cfg = { parametros: validarParametros(ler('parametros')), empresa: ler('empresa'), textos: ler('textos') }
  const { empresa } = cfg
  for (const c of ['nome', 'nome_curto', 'horario_atendimento']) if (!empresa[c]) throw new Error(`empresa.json: ${c} ausente`)
  if (!Array.isArray(empresa.cidades_atendidas) || empresa.cidades_atendidas.length === 0) throw new Error('empresa.json: cidades_atendidas vazio')
  if (!(empresa.validade_dias > 0)) throw new Error('empresa.json: validade_dias deve ser > 0')
  if (empresa.logo) empresa.logo = fileURLToPath(new URL(`../${empresa.logo}`, import.meta.url))
  return cfg
}
