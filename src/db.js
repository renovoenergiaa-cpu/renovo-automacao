// Persistência em SQLite (nativo do Node). Um arquivo, sem servidor de banco.
// Eventos do funil não guardam telefone nem nome: só o id aleatório da conversa e valores categóricos.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS recebidos (
  id TEXT PRIMARY KEY, corpo TEXT NOT NULL, recebido_em INTEGER NOT NULL,
  processado_em INTEGER, tentativas INTEGER NOT NULL DEFAULT 0, erro TEXT);
CREATE TABLE IF NOT EXISTS mensagens (id TEXT PRIMARY KEY, em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversas (
  telefone TEXT PRIMARY KEY, id TEXT NOT NULL, estado TEXT NOT NULL, nome_perfil TEXT, origem TEXT,
  gratis_ate INTEGER, lembretes INTEGER NOT NULL DEFAULT 0,
  cliente_em INTEGER, bot_em INTEGER, humano_em INTEGER, criada_em INTEGER NOT NULL, atualizada_em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS eventos (
  n INTEGER PRIMARY KEY AUTOINCREMENT, conversa TEXT NOT NULL, tipo TEXT NOT NULL, dados TEXT, em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS eventos_tipo_em ON eventos (tipo, em);
CREATE TABLE IF NOT EXISTS propostas (
  numero INTEGER PRIMARY KEY AUTOINCREMENT, telefone TEXT NOT NULL, hash TEXT NOT NULL, conversa TEXT NOT NULL,
  dados TEXT NOT NULL, arquivo TEXT, entrega TEXT, criada_em INTEGER NOT NULL, UNIQUE (telefone, hash));
CREATE TABLE IF NOT EXISTS ajustes (chave TEXT PRIMARY KEY, valor TEXT);
`

const json = (v) => (v == null ? null : JSON.stringify(v))
const obj = (s) => (s ? JSON.parse(s) : null)

export function abrirBanco(caminho = ':memory:') {
  const sql = new DatabaseSync(caminho)
  sql.exec(ESQUEMA)
  const um = (q, ...a) => sql.prepare(q).get(...a)
  const todos = (q, ...a) => sql.prepare(q).all(...a)
  const rodar = (q, ...a) => sql.prepare(q).run(...a)
  const conversaDe = (r) => r && { ...r, estado: obj(r.estado), origem: obj(r.origem) }

  return {
    fechar: () => sql.close(),
    todos,
    transacao(fn) {
      sql.exec('BEGIN IMMEDIATE')
      try {
        const r = fn()
        sql.exec('COMMIT')
        return r
      } catch (e) {
        sql.exec('ROLLBACK')
        throw e
      }
    },

    // Caixa de entrada dos webhooks: grava antes de responder 200; o id do evento barra repetições.
    guardarRecebido: (id, corpo, em) => rodar('INSERT OR IGNORE INTO recebidos (id, corpo, recebido_em) VALUES (?, ?, ?)', id, corpo, em).changes === 1,
    // Processado: apaga o corpo (tem dados pessoais) e fica só o id para deduplicar.
    marcarProcessado: (id, em) => rodar("UPDATE recebidos SET processado_em = ?, corpo = '', erro = NULL WHERE id = ?", em, id),
    marcarErro: (id, erro) => rodar('UPDATE recebidos SET tentativas = tentativas + 1, erro = ? WHERE id = ?', erro, id),
    pendentes: (antesDe, maxTentativas = 3) =>
      todos('SELECT id, corpo FROM recebidos WHERE processado_em IS NULL AND tentativas < ? AND recebido_em < ? ORDER BY recebido_em', maxTentativas, antesDe),
    contarPendentes: () => um('SELECT count(*) n FROM recebidos WHERE processado_em IS NULL').n,

    mensagemVista: (id) => !!um('SELECT 1 FROM mensagens WHERE id = ?', id),
    registrarMensagem: (id, em) => rodar('INSERT OR IGNORE INTO mensagens (id, em) VALUES (?, ?)', id, em),

    conversa: (telefone) => conversaDe(um('SELECT * FROM conversas WHERE telefone = ?', telefone)),
    novaConversa: (telefone, em) => ({ telefone, id: randomUUID(), estado: {}, nome_perfil: null, origem: null, gratis_ate: null, lembretes: 0, cliente_em: null, bot_em: null, humano_em: null, criada_em: em }),
    salvarConversa: (c, em) =>
      rodar(
        `INSERT INTO conversas (telefone, id, estado, nome_perfil, origem, gratis_ate, lembretes, cliente_em, bot_em, humano_em, criada_em, atualizada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (telefone) DO UPDATE SET id = excluded.id, estado = excluded.estado, nome_perfil = excluded.nome_perfil, origem = excluded.origem,
           gratis_ate = excluded.gratis_ate, lembretes = excluded.lembretes, cliente_em = excluded.cliente_em, bot_em = excluded.bot_em,
           humano_em = excluded.humano_em, criada_em = excluded.criada_em, atualizada_em = excluded.atualizada_em`,
        c.telefone, c.id, json(c.estado), c.nome_perfil ?? null, json(c.origem), c.gratis_ate ?? null, c.lembretes ?? 0,
        c.cliente_em ?? null, c.bot_em ?? null, c.humano_em ?? null, c.criada_em, em,
      ),
    conversasComClienteDesde: (em) => todos('SELECT telefone FROM conversas WHERE cliente_em >= ?', em).map((r) => r.telefone),
    conversas: () => todos('SELECT * FROM conversas ORDER BY atualizada_em DESC').map(conversaDe),

    evento: (conversa, tipo, dados, em) => rodar('INSERT INTO eventos (conversa, tipo, dados, em) VALUES (?, ?, ?, ?)', conversa, tipo, json(dados), em),
    eventos: (desde = 0) => todos('SELECT conversa, tipo, dados, em FROM eventos WHERE em >= ? ORDER BY n', desde).map((e) => ({ ...e, dados: obj(e.dados) })),

    propostaPor: (telefone, hash) => um('SELECT * FROM propostas WHERE telefone = ? AND hash = ?', telefone, hash),
    proposta: (numero) => um('SELECT * FROM propostas WHERE numero = ?', numero),
    criarProposta: (p) =>
      um('INSERT INTO propostas (telefone, hash, conversa, dados, criada_em) VALUES (?, ?, ?, ?, ?) RETURNING *', p.telefone, p.hash, p.conversa, json(p.dados), p.criada_em),
    atualizarProposta: (numero, { arquivo, entrega }) =>
      rodar('UPDATE propostas SET arquivo = coalesce(?, arquivo), entrega = coalesce(?, entrega) WHERE numero = ?', arquivo ?? null, entrega ?? null, numero),

    ajuste: (chave) => um('SELECT valor FROM ajustes WHERE chave = ?', chave)?.valor ?? null,
    definirAjuste: (chave, valor) => rodar('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor', chave, String(valor)),

    /** Retenção: apaga dados pessoais antigos. Os eventos (sem telefone nem nome) ficam para as métricas. */
    purgar(antesDe, antesDeTecnico) {
      const arquivos = todos('SELECT arquivo FROM propostas WHERE criada_em < ? AND arquivo IS NOT NULL', antesDe).map((r) => r.arquivo)
      rodar('DELETE FROM propostas WHERE criada_em < ?', antesDe)
      rodar('DELETE FROM conversas WHERE atualizada_em < ?', antesDe)
      rodar('DELETE FROM mensagens WHERE em < ?', antesDeTecnico)
      rodar('DELETE FROM recebidos WHERE recebido_em < ?', antesDeTecnico)
      return arquivos
    },
    /** Pedido de exclusão (LGPD): remove tudo o que identifica a pessoa. */
    apagarPessoa(telefone) {
      const arquivos = todos('SELECT arquivo FROM propostas WHERE telefone = ? AND arquivo IS NOT NULL', telefone).map((r) => r.arquivo)
      rodar('DELETE FROM propostas WHERE telefone = ?', telefone)
      const { changes } = rodar('DELETE FROM conversas WHERE telefone = ?', telefone)
      return { arquivos, apagou: changes === 1 }
    },
  }
}
