// Máquina de estados da conversa. Função pura: (conversa, entrada, contexto) -> { conv, acoes }.
// Não envia nada nem grava nada; quem executa as ações é src/app.js.
import { avaliar, interpretarConta } from './orcamento.js'

export const ETAPAS = ['cidade', 'imovel', 'conta', 'telhado', 'nome'] // ordem das perguntas
const LIMITE_FALHAS = 2 // respostas não entendidas seguidas antes de chamar uma pessoa
const MAX_CIDADES_NA_LISTA = 9 // a lista do WhatsApp tem 10 linhas; a última é "Outra cidade"

export const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const slug = (s) => normalizar(s).replaceAll(' ', '-')
const preencher = (modelo, vars) => modelo.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')

const INTENTOS = [
  ['parar', /\b(parar|pare|sair|cancelar|descadastrar|nao quero mais|stop)\b/],
  // sem "pessoa" solta: colide com nomes e cidades (João Pessoa)
  ['consultor', /\b(atendente|humano|consultor|vendedor|especialista|falar com (alguem|uma pessoa|voces|vcs|gente))\b/],
  ['recomecar', /\b(recomecar|reiniciar|comecar de novo|do zero)\b/],
  ['corrigir', /\b(voltar|corrigir|errei)\b/],
]
const intentoDoTexto = (texto) => INTENTOS.find(([, re]) => re.test(normalizar(texto)))?.[0] ?? null

/** Nome do perfil do WhatsApp sem emojis/símbolos; null se não sobrar um nome utilizável. */
export function nomeLimpo(s) {
  // NFC junta letra + acento num caractere só; assim marcas soltas (ex.: seletor de emoji) são descartadas.
  const n = String(s ?? '').normalize('NFC').replace(/[^\p{L}'. -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return /^\p{L}[\p{L}'. -]+$/u.test(n) ? n : null
}

const rotulo = (lista, id) => lista.find((x) => x.id === id)?.rotulo ?? ''

function proximaEtapa(conv, ctx) {
  if (conv.dados.nome === undefined && nomeLimpo(ctx.nomePerfil)) conv.dados.nome = nomeLimpo(ctx.nomePerfil)
  return ETAPAS.find((e) => conv.dados[e] === undefined) ?? 'confirmar'
}

/** Ações que (re)fazem a pergunta da etapa atual. Também usada pelos lembretes. */
export function pergunta(conv, ctx) {
  const { textos: t, parametros: p, empresa } = ctx
  const d = conv.dados
  const opcoes = (texto, lista, botao) => [{ tipo: 'opcoes', texto, opcoes: lista, botao }]
  const texto = (s) => [{ tipo: 'texto', texto: s }]
  const cidades = empresa.cidades_atendidas

  switch (conv.etapa) {
    case 'cidade':
      // Com muitas cidades, aparecem as primeiras da lista (ordem de config/empresa.json); as outras valem digitando.
      return opcoes(
        t.pergunta_cidade,
        [...cidades.slice(0, MAX_CIDADES_NA_LISTA).map((c) => ({ id: `cidade:${slug(c)}`, titulo: c })), { id: 'cidade:outra', titulo: t.opcao_outra_cidade }],
        t.botao_lista_cidade,
      )
    case 'cidade_outra':
      return texto(t.pergunta_cidade_outra)
    case 'imovel':
      return opcoes(t.pergunta_imovel, p.imoveis.map((i) => ({ id: `imovel:${i.id}`, titulo: i.rotulo, sinonimos: i.sinonimos })))
    case 'conta':
      return opcoes(t.pergunta_conta, p.faixas_conta.map((f) => ({ id: `conta:${f.id}`, titulo: f.rotulo })), t.botao_lista_conta)
    case 'telhado':
      return opcoes(t.pergunta_telhado, p.telhados.map((x) => ({ id: `telhado:${x.id}`, titulo: x.rotulo, sinonimos: x.sinonimos })), t.botao_lista_telhado)
    case 'nome':
      return texto(t.pergunta_nome)
    case 'confirmar':
      return opcoes(
        preencher(t.confirmar, {
          cidade: d.cidade,
          imovel: rotulo(p.imoveis, d.imovel),
          conta: d.conta.rotulo,
          linha_telhado: d.telhado === 'na' ? '' : `\n• Telhado: *${rotulo(p.telhados, d.telhado)}*`,
          nome: d.nome,
        }),
        [
          { id: 'confirmar:gerar', titulo: t.confirmar_gerar },
          { id: 'confirmar:corrigir', titulo: t.confirmar_corrigir },
        ],
      )
    case 'corrigir':
      return opcoes(
        t.pergunta_corrigir,
        ETAPAS.filter((e) => !(e === 'telhado' && d.telhado === 'na')).map((e) => ({ id: `corrigir:${e}`, titulo: t[`corrigir_${e}`] })),
        t.botao_lista_corrigir,
      )
    case 'pos':
      return opcoes(t.pos_proposta, [
        { id: 'acao:consultor', titulo: t.pos_consultor },
        { id: 'acao:visita', titulo: t.pos_visita },
        { id: 'pos:depois', titulo: t.pos_depois },
      ])
    case 'fora':
      return opcoes(preencher(t.fora_area, { empresa: empresa.nome_curto, cidade: d.cidade_fora }), [
        { id: 'fora:avisar', titulo: t.fora_avisar },
        { id: 'fora:nao', titulo: t.fora_nao },
      ])
    default:
      return []
  }
}

/** Opção escolhida por clique (id) ou por texto digitado equivalente ao título. */
function escolha(entrada, lista) {
  if (entrada.tipo === 'opcao') return lista.find((o) => o.id === entrada.id) ?? null
  if (entrada.tipo !== 'texto') return null
  const dito = normalizar(entrada.texto)
  if (!dito) return null
  const exata = lista.filter((o) => normalizar(o.titulo) === dito)
  if (exata.length === 1) return exata[0]
  const contida = lista.filter((o) => [o.titulo, ...(o.sinonimos ?? [])].some((x) => ` ${dito} `.includes(` ${normalizar(x)} `)))
  return contida.length === 1 ? contida[0] : null
}

export function passo(convAnterior, entrada, ctx) {
  const conv = structuredClone(convAnterior ?? {})
  conv.dados ??= {}
  conv.falhas ??= 0
  conv.status ??= 'bot'
  const acoes = []
  const { textos: t, parametros: p, empresa } = ctx
  const base = { empresa: empresa.nome_curto, horario: empresa.horario_atendimento, nome: conv.dados.nome }

  const dizer = (chave, extra = {}) => acoes.push({ tipo: 'texto', texto: preencher(t[chave], { ...base, ...extra }) })
  const evento = (nome, dados) => acoes.push({ tipo: 'evento', nome, dados })
  const perguntar = () => acoes.push(...pergunta(conv, ctx))
  const fim = () => ({ conv, acoes })
  const humano = (motivo, chave, extra) => {
    dizer(chave, extra)
    conv.status = 'humano'
    evento('handoff', { motivo, etapa: conv.etapa })
    acoes.push({ tipo: 'humano', motivo })
    return fim()
  }
  const falha = (chave, repetirPergunta = true) => {
    if (ctx.retorno) {
      dizer('retomada') // voltou depois de um tempo: relembra a pergunta sem contar como erro
      perguntar()
      return fim()
    }
    conv.falhas += 1
    evento('nao_entendido', { etapa: conv.etapa })
    if (conv.falhas >= LIMITE_FALHAS) return humano('nao_entendeu', 'humano_nao_entendi')
    dizer(chave)
    if (repetirPergunta) perguntar()
    return fim()
  }
  const concluir = (etapa, valor) => {
    conv.falhas = 0
    evento('etapa_concluida', { etapa, valor })
    conv.etapa = proximaEtapa(conv, ctx)
    perguntar()
    return fim()
  }

  const nova = !conv.etapa || conv.etapa === 'fim'
  if (nova) {
    conv.dados = {}
    conv.falhas = 0
    conv.etapa = 'cidade'
    evento('conversa_iniciada')
  }

  // 1. Ações globais: valem em qualquer etapa, inclusive em botões de mensagens antigas.
  const intento =
    entrada.tipo === 'opcao' && entrada.id.startsWith('acao:')
      ? entrada.id.slice(5)
      : entrada.tipo === 'texto'
        ? intentoDoTexto(entrada.texto)
        : null
  if (intento === 'parar') {
    conv.optout = true
    conv.etapa = 'fim'
    evento('optout')
    dizer('optout')
    return fim()
  }
  if (intento === 'consultor') return humano('consultor', 'humano_pedido')
  if (intento === 'visita') return humano('visita', 'humano_visita')
  if (intento === 'recomecar' && !nova) {
    conv.dados = {}
    conv.falhas = 0
    conv.etapa = 'cidade'
    evento('recomecou')
    dizer('recomecar')
    perguntar()
    return fim()
  }
  if (intento === 'corrigir' && !nova && [...ETAPAS, 'cidade_outra', 'confirmar', 'pos'].includes(conv.etapa)) {
    if (Object.keys(conv.dados).length) conv.etapa = 'corrigir'
    perguntar()
    return fim()
  }

  if (nova) {
    const primeiro = nomeLimpo(ctx.nomePerfil)?.split(' ')[0]
    const url = empresa.politica_privacidade_url
    dizer('abertura', { saudacao_nome: primeiro ? `, ${primeiro}` : '', privacidade: url ? `\n\nPolítica de privacidade: ${url}` : '' })
    conv.etapa = proximaEtapa(conv, ctx) // preenche o nome pelo perfil, se houver
    perguntar()
    return fim()
  }

  // 2. Mídia (áudio, foto, arquivo...)
  if (entrada.tipo === 'midia') {
    if (conv.etapa === 'conta' && ['image', 'document'].includes(entrada.midia)) return humano('conta_enviada', 'humano_conta_enviada')
    if (conv.etapa === 'pos') return humano('duvida', 'humano_duvida')
    return falha('midia')
  }

  // 3. Clique em botão de uma pergunta que não é a atual: não muda nada, só reorienta.
  if (entrada.tipo === 'opcao' && entrada.id.split(':')[0] !== conv.etapa.split('_')[0]) {
    evento('clique_antigo', { etapa: conv.etapa, id: entrada.id })
    dizer('opcao_antiga')
    perguntar()
    return fim()
  }

  // 4. Resposta da etapa atual
  const [atual] = pergunta(conv, ctx)
  const op = atual?.opcoes ? escolha(entrada, atual.opcoes) : null
  const id = op?.id.split(':')[1]

  switch (conv.etapa) {
    case 'cidade':
    case 'cidade_outra': {
      if (id === 'outra' || entrada.id === 'cidade:outra') {
        conv.etapa = 'cidade_outra'
        perguntar()
        return fim()
      }
      const digitada = entrada.tipo === 'texto' ? entrada.texto.normalize('NFC').trim().replace(/\s+/g, ' ') : ''
      // Texto: aceita o nome dentro da frase ("Sorocaba SP", "moro em Sorocaba"), desde que aponte para uma cidade só.
      // O nome mais longo vence quando contém o outro ("Salto de Pirapora" contém "Salto"); duas cidades diferentes = ambíguo.
      const candidatas = empresa.cidades_atendidas
        .filter((c) => (entrada.tipo === 'opcao' ? `cidade:${slug(c)}` === entrada.id : ` ${normalizar(digitada)} `.includes(` ${normalizar(c)} `)))
        .sort((a, b) => b.length - a.length)
      const semAmbiguidade = candidatas.slice(1).every((c) => ` ${normalizar(candidatas[0])} `.includes(` ${normalizar(c)} `))
      const atendida = candidatas.length && semAmbiguidade ? candidatas[0] : undefined
      if (atendida) {
        conv.dados.cidade = atendida
        return concluir('cidade', atendida)
      }
      const pediuDigitar = conv.etapa === 'cidade_outra'
      if (pediuDigitar && /^\p{L}[\p{L}'. -]{1,39}$/u.test(digitada)) {
        conv.dados.cidade_fora = digitada
        // Enquanto a lista de cidades da região não estiver fechada, quem decide é uma pessoa.
        if (empresa.cidade_fora === 'consultar') {
          evento('cidade_a_confirmar', { cidade: digitada })
          return humano('cidade_a_confirmar', 'humano_cidade', { cidade: digitada })
        }
        conv.etapa = 'fora'
        evento('fora_area', { cidade: digitada })
        perguntar()
        return fim()
      }
      return falha('nao_entendi')
    }
    case 'fora':
      if (!op) return falha('nao_entendi')
      if (id === 'avisar') evento('fora_area_interesse', { cidade: conv.dados.cidade_fora })
      dizer(id === 'avisar' ? 'fora_avisar_resposta' : 'fora_nao_resposta', { cidade: conv.dados.cidade_fora })
      conv.etapa = 'fim'
      return fim()
    case 'imovel': {
      if (!op) return falha('nao_entendi')
      conv.dados.imovel = id
      const semTelhado = p.imoveis.find((i) => i.id === id)?.sem_telhado
      if (semTelhado) conv.dados.telhado = 'na'
      else if (conv.dados.telhado === 'na') delete conv.dados.telhado
      return concluir('imovel', id)
    }
    case 'conta': {
      const f = op && p.faixas_conta.find((x) => x.id === id)
      const conta = f
        ? { tipo: f.min == null ? 'desconhecida' : 'reais', min: f.min, max: f.max, rotulo: f.rotulo }
        : entrada.tipo === 'texto' && interpretarConta(entrada.texto)
      if (!conta) return falha('nao_entendi')
      conv.dados.conta = conta
      return concluir('conta', f ? f.id : `digitado_${conta.tipo}`)
    }
    case 'telhado':
      if (!op) return falha('nao_entendi')
      conv.dados.telhado = id
      return concluir('telhado', id)
    case 'nome': {
      const bruto = entrada.tipo === 'texto' ? entrada.texto.replace(/^\s*(meu nome [eé]|me chamo|eu sou|sou)\s+/i, '') : ''
      const nome = /[?\d]/.test(bruto) ? null : nomeLimpo(bruto)
      if (!nome || nome.split(' ').length > 5) return falha('nome_invalido', false)
      conv.dados.nome = nome
      return concluir('nome')
    }
    case 'corrigir': {
      if (!op) return falha('nao_entendi')
      delete conv.dados[id]
      conv.falhas = 0
      conv.etapa = id
      perguntar()
      return fim()
    }
    case 'confirmar': {
      if (!op) return falha('nao_entendi')
      if (id === 'corrigir') {
        conv.etapa = 'corrigir'
        perguntar()
        return fim()
      }
      conv.falhas = 0
      const orcamento = avaliar(conv.dados, p)
      if (orcamento.tipo === 'analise_humana') {
        evento('analise_humana', { motivo: orcamento.motivo })
        return humano(orcamento.motivo, 'humano_analise', { motivo: t[`motivo_${orcamento.motivo}`] })
      }
      evento('qualificado')
      dizer('gerando', { nome: conv.dados.nome.split(' ')[0] })
      acoes.push({ tipo: 'proposta', orcamento })
      conv.etapa = 'pos'
      perguntar()
      return fim()
    }
    case 'pos':
      if (id === 'depois') {
        conv.sem_lembrete = true
        evento('adiou')
        dizer('pos_depois_resposta')
        return fim()
      }
      return humano('duvida', 'humano_duvida') // qualquer texto depois do PDF é, na prática, uma dúvida comercial
    default:
      return falha('nao_entendi')
  }
}
