# Automação WhatsApp — energia solar

Lead do Meta Ads → WhatsApp → 4 perguntas por botões/listas → PDF de estimativa → consultor no mesmo número.
Ao retomar, leia `PROGRESSO.md` primeiro. Especificação em `docs/ESPEC.md`.

## Decisões
- API oficial do WhatsApp via YCloud, com coexistência (vendedor no app, mesmo número). Só `src/ycloud.js` conhece o provedor.
- Backend Node 22 sem framework; SQLite nativo (`node:sqlite`); única dependência: pdfkit. Sem n8n.
- Fluxo determinístico, sem IA em produção. O que o bot não entende vai para uma pessoa.
- Custo zero de mensagens: por padrão o bot só fala na janela gratuita de 72h aberta por anúncio (`BOT_SEM_ANUNCIO=0`).

## Comandos
- `npm test` — 88 testes (WhatsApp simulado). Lógica usa tabela fixa em `test/`; a real é conferida em `test/config-real.test.js`.
- `npm run exemplo` — gera os PDFs em `exemplos/`.
- `npm start` — exige `.env`; `npm run cli -- relatorio|leads|venda|pausar|retomar|devolver|apagar`.
- Nesta máquina, HTTPS no Node só funciona com `SSL_CERT_FILE=/usr/local/etc/ca-certificates/cert.pem`.

## Limites
- Tudo em pt-BR, valores em R$, linguagem simples.
- Preço e dimensionamento só por `config/parametros.json`; nunca por texto livre de modelo.
- A tabela já tem os kits e as regras reais da Renovo (origem em `docs/REGRAS-CALCULO.md`), mas não está aprovada. Só marcar `aprovado` com autorização explícita do usuário e nome do responsável.
- Não inventar preço, garantia, cobertura, taxa de financiamento, depoimento ou promessa de economia.
- Não enviar mensagem a cliente real, alterar campanha, contratar serviço ou ativar produção sem autorização explícita.
- Segredos só em `.env`. Dados de clientes só em `data/`. Ambos fora do git, dos logs e do grafo.
- Textos do bot ficam em `config/textos.json`; respeitar 20 caracteres por botão e 24 por linha de lista (há teste).

## Ferramentas de desenvolvimento
- Processo: plugin `agent-skills@addy-agent-skills` (escopo projeto). Complexidade: Ponytail.
- Marketing: 12 skills em `.claude/skills/`; contexto em `.agents/product-marketing.md` (adaptar: não é SaaS).
- PDF: skill `anthropic-skills:pdf` só para inspecionar; produção gera por `src/pdf.js`.
- Carregar apenas a skill necessária à etapa.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Exclusões em `.graphifyignore` (segredos, `data/`, `insumos/`, PDFs, ferramentas).
