// Template versionado da estimativa em PDF (pdfkit). Produção gera por aqui, sem depender de IA.
// Página A5: lê bem na tela do celular e imprime em A4 sem cortar.
import PDFDocument from 'pdfkit'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { brl, num, faixa } from './orcamento.js'

export const VERSAO_TEMPLATE = 'estimativa-v1'

const M = 28 // margem
const COR = { texto: '#1F2933', suave: '#5F6B76', linha: '#D9DEE3', fundo: '#F1F4F8', aviso: '#FFF3E8' }
const dataBR = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms))
const DIA = 86_400_000

export const numeroProposta = (n, criadaEm) => `${new Date(criadaEm).getFullYear()}-${String(n).padStart(5, '0')}`

/** Junta tudo o que o template precisa. `real` = parâmetros aprovados e empresa definitiva. */
export function documentoDaProposta({ numero, criadaEm, cfg, dados, orcamento, real }) {
  const { empresa, parametros: p } = cfg
  const rotulo = (lista, id) => lista.find((x) => x.id === id)?.rotulo ?? null
  return {
    numero: numeroProposta(numero, criadaEm),
    emitida_em: criadaEm,
    valida_ate: criadaEm + empresa.validade_dias * DIA,
    empresa,
    cliente: {
      nome: dados.nome,
      cidade: dados.cidade,
      imovel: rotulo(p.imoveis, dados.imovel),
      telhado: rotulo(p.telhados, dados.telhado),
      conta: dados.conta.rotulo,
      conta_em_kwh: dados.conta.tipo === 'kwh',
    },
    orcamento,
    listas: { incluidos: p.itens_incluidos, nao_incluidos: p.itens_nao_incluidos, condicoes: p.condicoes, garantias: p.garantias },
    marca_dagua: real ? null : p.meta.ficticio ? 'EXEMPLO — DADOS FICTÍCIOS' : 'RASCUNHO — NÃO APROVADO',
  }
}

export function gerarPdf(d, destino) {
  return new Promise((resolve, reject) => {
    mkdirSync(dirname(destino), { recursive: true, mode: 0o700 })
    const doc = new PDFDocument({
      size: 'A5', margin: M, bufferPages: true, lang: 'pt-BR',
      info: { Title: `Estimativa ${d.numero} — ${d.empresa.nome}`, Author: d.empresa.nome, Subject: 'Estimativa de energia solar' },
    })
    const saida = createWriteStream(destino, { mode: 0o600 }) // só o usuário do serviço lê: contém dados do cliente
    saida.on('finish', resolve).on('error', reject)
    doc.on('error', reject)
    doc.pipe(saida)
    desenhar(doc, d)
    doc.end()
  })
}

function desenhar(doc, d) {
  const { empresa, cliente, orcamento: o } = d
  const primaria = empresa.cor_primaria ?? '#0E5A43'
  const destaque = empresa.cor_destaque ?? '#F5A300'
  const L = M
  const W = doc.page.width - 2 * M
  const FUNDO = doc.page.height - M - 22 // reserva do rodapé
  let y = 0

  const garantir = (h) => { if (y + h > FUNDO) { doc.addPage(); y = M } }
  const secao = (t, reserva = 46) => {
    garantir(reserva)
    y += 8
    doc.font('Helvetica-Bold').fontSize(12).fillColor(primaria).text(t, L, y, { width: W })
    y = doc.y + 3
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor(COR.linha).stroke()
    y += 8
  }
  const paragrafo = (t, { tamanho = 9.5, cor = COR.texto, negrito = false, recuo = 0 } = {}) => {
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamanho)
    garantir(doc.heightOfString(t, { width: W - recuo, lineGap: 2 }))
    doc.fillColor(cor).text(t, L + recuo, y, { width: W - recuo, lineGap: 2 })
    y = doc.y + 5
  }
  const marcadores = (itens) => {
    for (const item of itens) {
      doc.font('Helvetica').fontSize(9.5)
      garantir(doc.heightOfString(item, { width: W - 12, lineGap: 2 }))
      doc.fillColor(primaria).text('•', L, y)
      doc.fillColor(COR.texto).text(item, L + 12, y, { width: W - 12, lineGap: 2 })
      y = doc.y + 4
    }
    y += 2
  }

  // --- Cabeçalho: fundo branco, para o logo aparecer nas cores originais da marca ---
  if (empresa.logo && existsSync(empresa.logo)) doc.image(empresa.logo, L, 20, { fit: [170, 52] })
  else doc.font('Helvetica-Bold').fontSize(17).fillColor(primaria).text(empresa.nome, L, 34, { width: W * 0.6 })
  doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave).text('ESTIMATIVA Nº', L, 24, { width: W, align: 'right' })
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primaria).text(d.numero, L, 34, { width: W, align: 'right' })
  doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(`Emitida em ${dataBR(d.emitida_em)}`, L, 52, { width: W, align: 'right' })
  doc.rect(0, 84, doc.page.width, 3).fill(primaria)
  doc.rect(0, 87, doc.page.width, 1.5).fill(destaque)

  y = 106
  doc.font('Helvetica-Bold').fontSize(17).fillColor(COR.texto).text('Estimativa de energia solar', L, y, { width: W })
  y = doc.y + 2
  doc.font('Helvetica').fontSize(11).fillColor(COR.suave).text(`Preparada para ${cliente.nome}`, L, y, { width: W })
  y = doc.y + 10

  // Aviso: é estimativa
  const aviso = `Esta é uma estimativa inicial, feita com as informações que você enviou pelo WhatsApp. O valor final depende de vistoria e validação técnica. Válida até ${dataBR(d.valida_ate)}.`
  doc.font('Helvetica').fontSize(9.5)
  const hAviso = doc.heightOfString(aviso, { width: W - 24, lineGap: 2 }) + 16
  doc.rect(L, y, W, hAviso).fill(COR.aviso)
  doc.rect(L, y, 4, hAviso).fill(destaque)
  doc.fillColor(COR.texto).text(aviso, L + 14, y + 8, { width: W - 24, lineGap: 2 })
  y += hAviso + 4

  // --- O que você informou ---------------------------------------------------
  secao('O que você informou')
  const campos = [
    ['Cidade', cliente.cidade],
    ['Tipo de imóvel', cliente.imovel],
    [cliente.conta_em_kwh ? 'Consumo de energia' : 'Conta de luz (por mês)', cliente.conta],
    ['Telhado', cliente.telhado],
  ].filter(([, v]) => v)
  const col = W / 2
  campos.forEach(([k, v], i) => {
    const x = L + (i % 2) * col
    if (i % 2 === 0 && i > 0) y += 30
    doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(k, x, y, { width: col - 8 })
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COR.texto).text(v, x, y + 11, { width: col - 8 })
  })
  y += 32

  // --- Sistema sugerido ------------------------------------------------------
  secao('Sistema sugerido')
  const blocos = [
    [faixa(...o.paineis), 'painéis'],
    o.kwp && [`${faixa(...o.kwp.map((v) => num(v, 2)), (s) => s)} kWp`, 'potência'],
    [`${faixa(...o.geracao_kwh)} kWh`, 'geração estimada por mês'],
  ].filter(Boolean)
  const vao = 6
  const wb = (W - (blocos.length - 1) * vao) / blocos.length
  blocos.forEach(([valor, legenda], i) => {
    const x = L + i * (wb + vao)
    doc.rect(x, y, wb, 46).fill(COR.fundo)
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(primaria).text(valor, x + 4, y + 10, { width: wb - 8, align: 'center' })
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave).text(legenda, x + 4, y + 28, { width: wb - 8, align: 'center' })
  })
  y += 46 + 6

  // --- Investimento ----------------------------------------------------------
  secao('Investimento estimado')
  doc.rect(L, y, W, 58).fill(primaria)
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF').text(faixa(...o.investimento, brl), L, y + 12, { width: W, align: 'center' })
  doc.font('Helvetica').fontSize(8).text('Conforme a tabela de kits vigente. O valor exato sai depois da vistoria.', L, y + 38, { width: W, align: 'center' })
  y += 58 + 10
  paragrafo('Próximo passo', { negrito: true, tamanho: 10.5, cor: primaria })
  y -= 3
  paragrafo('Responda à nossa conversa no WhatsApp para falar com um consultor ou agendar a visita técnica. Na visita confirmamos o telhado, a rede elétrica e o valor final.')

  // --- Economia --------------------------------------------------------------
  const NAO_ZERA = 'A conta de luz não zera: continuam o custo mínimo da distribuidora, a iluminação pública e eventuais taxas.'
  if (o.economia_mensal) {
    secao('Economia estimada', o.economia_acumulada ? 215 : 160) // título, valor e explicação ficam na mesma página
    paragrafo(`${faixa(...o.economia_mensal, brl)} por mês`, { tamanho: 14, negrito: true, cor: primaria })
    y -= 2
    paragrafo(`Cerca de ${faixa(...o.economia_anual, brl)} por ano.`, { negrito: true })
    paragrafo(NAO_ZERA)
  }
  if (o.retorno_anos)
    paragrafo(`Tempo estimado de retorno do investimento: ${o.retorno_anos[0] === o.retorno_anos[1] ? 'cerca de ' + num(o.retorno_anos[0], 1) : `entre ${num(o.retorno_anos[0], 1)} e ${num(o.retorno_anos[1], 1)}`} anos. É uma estimativa, não uma garantia.`)
  if (o.economia_acumulada) {
    const ac = o.economia_acumulada
    paragrafo(`Em ${ac.anos} anos, a economia acumulada estimada é de ${faixa(...ac.valores, brl)}, considerando reajuste de ${pct(ac.reajuste_tarifa_anual)} ao ano na tarifa e perda de ${pct(ac.degradacao_anual)} ao ano na geração dos painéis. É uma projeção, não uma garantia.`)
  }

  // --- Premissas -------------------------------------------------------------
  secao('Como chegamos a esses números')
  const pr = o.premissas
  marcadores([
    cliente.conta_em_kwh
      ? `Consumo informado: ${cliente.conta}.`
      : `Conta informada: ${cliente.conta}. Consumo estimado: ${faixa(...o.consumo_kwh)} kWh por mês, pela tarifa de ${brlCentavos(pr.tarifa_reais_por_kwh)} por kWh.`,
    'Sistema sugerido: o menor kit cuja geração estimada cobre esse consumo.',
    pr.custo_disponibilidade_kwh > 0 && `Custo mínimo da distribuidora: ${num(pr.custo_disponibilidade_kwh)} kWh por mês, que não são compensados.`,
    o.economia_mensal && `Economia calculada sobre ${pct(pr.fator_economia)} do valor da energia gerada e aproveitada.`,
    !o.economia_mensal && NAO_ZERA,
    'A geração e a economia reais variam com o clima, a posição do telhado, sombras e tarifas.',
    `Parâmetros versão ${o.versao_parametros}, de ${o.data_parametros.split('-').reverse().join('/')}.`,
  ].filter(Boolean))

  // --- Equipamentos ----------------------------------------------------------
  secao('Kits de referência')
  if (o.kits.length > 1) paragrafo('O kit certo é definido pelo seu consumo real, na vistoria.')
  for (const k of o.kits) {
    paragrafo(`Kit de ${k.paineis} painéis — ${brl(k.preco_reais)}`, { negrito: true, tamanho: 10 })
    y -= 3
    const detalhes = [`Geração estimada: ${num(k.geracao_kwh)} kWh por mês`, k.kwp && `${num(k.kwp, 2)} kWp`, k.potencia_modulo_w && `módulos de ${k.potencia_modulo_w} W`, k.inversor]
    paragrafo(detalhes.filter(Boolean).join(' · '), { tamanho: 9, cor: COR.suave })
  }
  if (o.ressalvas.length) marcadores(o.ressalvas)

  const lista = (titulo, itens) => {
    if (!itens?.length) return
    doc.font('Helvetica').fontSize(9.5)
    const altura = 40 + itens.reduce((h, item) => h + doc.heightOfString(item, { width: W - 12, lineGap: 2 }) + 4, 0)
    secao(titulo, Math.min(altura, FUNDO - M)) // evita item órfão na página seguinte
    marcadores(itens)
  }
  lista('Equipamentos e materiais', d.listas.incluidos)
  lista('O que não está incluído', d.listas.nao_incluidos)
  lista('Condições', d.listas.condicoes)
  lista('Garantias', d.listas.garantias)

  // --- Contato (só aparece quando a empresa informar os dados) -----------------
  const contato = [empresa.cnpj && `CNPJ ${empresa.cnpj}`, empresa.endereco, empresa.telefone, empresa.email, empresa.site].filter(Boolean)
  if (contato.length) {
    secao('Contato')
    paragrafo([empresa.nome, ...contato].join(' · '), { tamanho: 9 })
  }

  // --- Rodapé e marca d'água em todas as páginas -----------------------------
  const { count } = doc.bufferedPageRange()
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i)
    doc.page.margins.bottom = 0 // senão o pdfkit cria página nova ao escrever no rodapé
    const yr = doc.page.height - M - 8
    doc.moveTo(L, yr - 6).lineTo(L + W, yr - 6).lineWidth(0.5).strokeColor(COR.linha).stroke()
    doc.font('Helvetica').fontSize(6.5).fillColor(COR.suave)
    doc.text(`${empresa.nome} · Estimativa nº ${d.numero} · Não é proposta comercial nem contrato.`, L, yr, { lineBreak: false })
    doc.text(`Página ${i + 1} de ${count}`, L, yr, { width: W, align: 'right', lineBreak: false })
    if (d.marca_dagua) {
      doc.save()
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
      doc.font('Helvetica-Bold').fontSize(26).fillColor('#C0392B').opacity(0.16)
      doc.text(d.marca_dagua, 0, doc.page.height / 2 - 14, { width: doc.page.width, align: 'center', lineBreak: false })
      doc.restore()
    }
  }
}

const pct = (v) => new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(v)
const brlCentavos = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
