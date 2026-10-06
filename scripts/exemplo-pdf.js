// Gera os PDFs de exemplo pelo mesmo caminho de código usado em produção:
//   exemplos/estimativa-exemplo.pdf    cliente que escolheu uma faixa de conta (resultado em faixa)
//   exemplos/estimativa-conta-850.pdf  cliente que digitou R$ 850 (mesmo caso do exemplo do sistema anterior)
import { carregarConfig } from '../src/config.js'
import { avaliar, usoReal, brl } from '../src/orcamento.js'
import { gerarPdf, documentoDaProposta } from '../src/pdf.js'

const cfg = carregarConfig()
const real = usoReal(cfg.parametros, cfg.empresa)
const f = cfg.parametros.faixas_conta.filter((x) => x.max != null && x.max > cfg.parametros.conta_minima_reais)[1]

const casos = [
  ['exemplos/estimativa-exemplo.pdf', { tipo: 'reais', min: f.min, max: f.max, rotulo: f.rotulo }],
  ['exemplos/estimativa-conta-850.pdf', { tipo: 'reais', min: 850, max: 850, rotulo: brl(850) }],
]
for (const [destino, conta] of casos) {
  const dados = { nome: 'Maria Oliveira (exemplo)', cidade: cfg.empresa.cidades_atendidas[0], imovel: 'casa', telhado: 'ceramica', conta }
  const orcamento = avaliar(dados, cfg.parametros)
  await gerarPdf(documentoDaProposta({ numero: 1, criadaEm: Date.now(), cfg, dados, orcamento, real }), destino)
  console.log('PDF gerado em', destino)
}
